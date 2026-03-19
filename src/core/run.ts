import pc from "picocolors";
import type { RunRequest, UsageInfo } from "../types.js";
import { createProvider } from "../providers/factory.js";
import { buildPrompt } from "../prompts/buildPrompt.js";
import { buildFallbackOutput } from "./fallback.js";
import { analyzeTestStatus, applyHeuristicPolicy, detectTestRunner } from "./heuristics.js";
import {
  buildInsufficientSignalOutput,
  isInsufficientSignalOutput
} from "./insufficient.js";
import { prepareInput } from "./pipeline.js";
import { isRetriableReason, looksLikeRejectedModelOutput } from "./quality.js";
import {
  buildTestStatusAnalysisContext,
  buildTestStatusDiagnoseContract,
  buildTestStatusPublicDiagnoseContract,
  parseTestStatusProviderSupplement,
  TEST_STATUS_DIAGNOSE_JSON_CONTRACT,
  TEST_STATUS_PROVIDER_SUPPLEMENT_JSON_CONTRACT,
  type TestStatusDiagnoseContract
} from "./testStatusDecision.js";
import { buildGenericRawSlice, buildTestStatusRawSlice } from "./rawSlice.js";
import type { RunResult, RunStats } from "./stats.js";

const RETRY_DELAY_MS = 300;
const PENDING_NOTICE_DELAY_MS = 150;

interface RunStatsRecorder {
  heuristic(): void;
  provider(usage?: UsageInfo): void;
  fallback(): void;
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function getDiagnosisCompleteAtLayer(contract: TestStatusDiagnoseContract): "heuristic" | "provider" | "raw" {
  if (contract.raw_needed || contract.provider_failed) {
    return "raw";
  }

  if (contract.provider_used) {
    return "provider";
  }

  return "heuristic";
}

function logVerboseTestStatusTelemetry(args: {
  request: RunRequest;
  prepared: ReturnType<typeof prepareInput>;
  heuristicInputChars: number;
  heuristicInputTruncated: boolean;
  contract: TestStatusDiagnoseContract;
  finalOutput: string;
  rawSliceChars?: number;
  providerInputChars?: number;
  providerOutputChars?: number;
}): void {
  if (!args.request.config.runtime.verbose) {
    return;
  }

  const lines = [
    `${pc.dim("sift")} diagnosis_complete_at_layer=${getDiagnosisCompleteAtLayer(args.contract)}`,
    `${pc.dim("sift")} heuristic_short_circuit=${!args.contract.provider_used && args.contract.diagnosis_complete && !args.contract.raw_needed && !args.contract.provider_failed}`,
    `${pc.dim("sift")} raw_input_chars=${args.request.stdin.length}`,
    `${pc.dim("sift")} heuristic_input_chars=${args.heuristicInputChars}`,
    `${pc.dim("sift")} heuristic_input_truncated=${args.heuristicInputTruncated}`,
    `${pc.dim("sift")} prepared_input_chars=${args.prepared.meta.finalLength}`,
    `${pc.dim("sift")} raw_slice_chars=${args.rawSliceChars ?? 0}`,
    `${pc.dim("sift")} provider_input_chars=${args.providerInputChars ?? 0}`,
    `${pc.dim("sift")} provider_output_chars=${args.providerOutputChars ?? 0}`,
    `${pc.dim("sift")} final_output_chars=${args.finalOutput.length}`,
    `${pc.dim("sift")} final_output_tokens_est=${estimateTokenCount(args.finalOutput)}`,
    `${pc.dim("sift")} read_targets_count=${args.contract.read_targets.length}`,
    `${pc.dim("sift")} remaining_count=${args.contract.remaining_tests.length}`,
    `${pc.dim("sift")} remaining_ids_exposed=${Boolean(args.request.includeTestIds)}`
  ];

  process.stderr.write(`${lines.join("\n")}\n`);
}

function normalizeOutput(text: string, responseMode: "text" | "json"): string {
  if (responseMode !== "json") {
    return text.trim();
  }

  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    throw new Error("Provider returned invalid JSON");
  }
}

function buildDryRunOutput(args: {
  request: RunRequest;
  providerName: string;
  prompt: string;
  responseMode: "text" | "json";
  prepared: ReturnType<typeof prepareInput>;
  heuristicInput: {
    length: number;
    truncatedApplied: boolean;
    strategy: "full-redacted";
  };
  heuristicOutput: string | null;
  strategy?: "heuristic" | "provider" | "hybrid";
}): string {
  return JSON.stringify(
    {
      status: "dry-run",
      strategy: args.strategy ?? (args.heuristicOutput ? "heuristic" : "provider"),
      provider: {
        name: args.providerName,
        model: args.request.config.provider.model,
        baseUrl: args.request.config.provider.baseUrl,
        jsonResponseFormat: args.request.config.provider.jsonResponseFormat
      },
      question: args.request.question,
      format: args.request.format,
      detail: args.request.detail ?? null,
      responseMode: args.responseMode,
      policy: args.request.policyName ?? null,
      heuristicOutput: args.heuristicOutput ?? null,
      heuristicInput: args.heuristicInput,
      input: {
        originalLength: args.prepared.meta.originalLength,
        finalLength: args.prepared.meta.finalLength,
        redactionApplied: args.prepared.meta.redactionApplied,
        truncatedApplied: args.prepared.meta.truncatedApplied,
        text: args.prepared.truncated
      },
      prompt: args.prompt
    },
    null,
    2
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function startPendingNotice(message: string, enabled: boolean): () => void {
  if (!enabled) {
    return () => {};
  }

  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    process.stderr.write(`${message}\r`);
  }, PENDING_NOTICE_DELAY_MS);

  return () => {
    clearTimeout(timer);
    if (!shown) {
      return;
    }

    process.stderr.write(`\r${" ".repeat(message.length)}\r`);
  };
}

function withInsufficientHint(args: {
  output: string;
  request: RunRequest;
  prepared: ReturnType<typeof prepareInput>;
}): string {
  if (!isInsufficientSignalOutput(args.output)) {
    return args.output;
  }

  return buildInsufficientSignalOutput({
    presetName: args.request.presetName,
    originalLength: args.prepared.meta.originalLength,
    truncatedApplied: args.prepared.meta.truncatedApplied,
    recognizedRunner: detectTestRunner(args.prepared.redacted)
  });
}

async function generateWithRetry(args: {
  provider: ReturnType<typeof createProvider>;
  request: RunRequest;
  prompt: string;
  responseMode: "text" | "json";
}): Promise<Awaited<ReturnType<ReturnType<typeof createProvider>["generate"]>>> {
  const generate = () =>
    args.provider.generate({
      model: args.request.config.provider.model,
      prompt: args.prompt,
      temperature: args.request.config.provider.temperature,
      maxOutputTokens: args.request.config.provider.maxOutputTokens,
      timeoutMs: args.request.config.provider.timeoutMs,
      responseMode: args.responseMode,
      jsonResponseFormat: args.request.config.provider.jsonResponseFormat
    });

  const stopPendingNotice = startPendingNotice(
    "sift waiting for provider...",
    Boolean(process.stderr.isTTY)
  );

  try {
    try {
      return await generate();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_error";

      if (!isRetriableReason(reason)) {
        throw error;
      }

      if (args.request.config.runtime.verbose) {
        process.stderr.write(
          `${pc.dim("sift")} retry=1 reason=${reason} delay_ms=${RETRY_DELAY_MS}\n`
        );
      }

      await delay(RETRY_DELAY_MS);
    }

    return await generate();
  } finally {
    stopPendingNotice();
  }
}

function hasRecognizableTestStatusSignal(input: string): boolean {
  const analysis = analyzeTestStatus(input);
  return (
    analysis.collectionErrorCount !== undefined ||
    analysis.noTestsCollected ||
    analysis.interrupted ||
    analysis.failed > 0 ||
    analysis.errors > 0 ||
    analysis.passed > 0 ||
    analysis.inlineItems.length > 0 ||
    analysis.buckets.length > 0
  );
}

function shouldUseCompactTestStatusBypass(args: {
  request: RunRequest;
  analysis: ReturnType<typeof analyzeTestStatus>;
}): boolean {
  if (args.request.policyName !== "test-status") {
    return false;
  }

  if (args.request.detail && args.request.detail !== "standard") {
    return false;
  }

  if (args.request.goal === "diagnose" && args.request.format === "json") {
    return false;
  }

  if (
    args.request.testStatusContext?.resolvedTests?.length ||
    args.request.testStatusContext?.remainingTests?.length ||
    args.request.testStatusContext?.remainingSubsetAvailable ||
    (args.request.testStatusContext?.remainingMode &&
      args.request.testStatusContext.remainingMode !== "none")
  ) {
    return false;
  }

  return (
    (args.analysis.failed === 0 && args.analysis.errors === 0 && args.analysis.passed > 0) ||
    (args.analysis.collectionErrorCount !== undefined &&
      args.analysis.collectionItems.length === 0 &&
      args.analysis.inlineItems.length === 0 &&
      args.analysis.buckets.length === 0) ||
    args.analysis.noTestsCollected ||
    (args.analysis.interrupted && args.analysis.failed === 0 && args.analysis.errors === 0)
  );
}

function sanitizeProviderFailureReason(reason: string): string {
  const normalized = reason.trim();
  const httpStatus = normalized.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (httpStatus) {
    return `provider follow-up unavailable (HTTP ${httpStatus})`;
  }

  if (
    /unterminated string|invalid json|unexpected token|json at position|schema|zod|parse/i.test(
      normalized
    )
  ) {
    return "provider follow-up returned unusable structured output";
  }

  return "provider follow-up failed";
}

function buildTestStatusFallbackContract(args: {
  contract: TestStatusDiagnoseContract;
  reason: string;
}): string {
  const sanitizedReason = sanitizeProviderFailureReason(args.reason);
  return JSON.stringify(
    {
      ...args.contract,
      status: "insufficient",
      diagnosis_complete: false,
      raw_needed: true,
      additional_source_read_likely_low_value: false,
      read_raw_only_if: "you still need exact traceback lines after the provider follow-up failed",
      next_best_action: {
        code: "read_raw_for_exact_traceback",
        bucket_index:
          args.contract.dominant_blocker_bucket_index ?? args.contract.main_buckets[0]?.bucket_index ?? null,
        note: `${sanitizedReason[0]!.toUpperCase()}${sanitizedReason.slice(
          1
        )}. Use focused or verbose detail, then raw only if exact traceback lines are still needed.`
      }
    },
    null,
    2
  );
}

function renderTestStatusDecisionOutput(args: {
  request: RunRequest;
  decision: ReturnType<typeof buildTestStatusDiagnoseContract>;
}): string {
  if (args.request.goal === "diagnose" && args.request.format === "json") {
    return JSON.stringify(
      buildTestStatusPublicDiagnoseContract({
        contract: args.decision.contract,
        includeTestIds: args.request.includeTestIds,
        remainingSubsetAvailable: args.request.testStatusContext?.remainingSubsetAvailable
      }),
      null,
      2
    );
  }

  if (args.request.detail === "verbose") {
    return args.decision.verboseText;
  }

  if (args.request.detail === "focused") {
    return args.decision.focusedText;
  }

  return args.decision.standardText;
}

function buildTestStatusProviderFailureDecision(args: {
  request: RunRequest;
  baseDecision: ReturnType<typeof buildTestStatusDiagnoseContract>;
  input: string;
  analysis: ReturnType<typeof analyzeTestStatus>;
  reason: string;
  rawSliceUsed: boolean;
  rawSliceStrategy: ReturnType<typeof buildTestStatusRawSlice>["strategy"];
}): ReturnType<typeof buildTestStatusDiagnoseContract> {
  const sanitizedReason = sanitizeProviderFailureReason(args.reason);
  const concreteReadTarget = args.baseDecision.contract.read_targets.find((target) =>
    Boolean(target.file)
  );
  const hasUnknownBucket = args.baseDecision.contract.main_buckets.some((bucket) =>
    bucket.root_cause.startsWith("unknown ")
  );
  if (concreteReadTarget && !hasUnknownBucket) {
    return buildTestStatusDiagnoseContract({
      input: args.input,
      analysis: args.analysis,
      resolvedTests: args.baseDecision.contract.resolved_tests,
      remainingTests: args.baseDecision.contract.remaining_tests,
      remainingMode: args.request.testStatusContext?.remainingMode,
      contractOverrides: {
        ...args.baseDecision.contract,
        diagnosis_complete: false,
        raw_needed: false,
        additional_source_read_likely_low_value: false,
        read_raw_only_if: null,
        decision: "read_source",
        provider_used: true,
        provider_confidence: null,
        provider_failed: true,
        raw_slice_used: args.rawSliceUsed,
        raw_slice_strategy: args.rawSliceStrategy,
        next_best_action: {
          code: "read_source_for_bucket",
          bucket_index:
            args.baseDecision.contract.dominant_blocker_bucket_index ??
            concreteReadTarget.bucket_index,
          note: `${sanitizedReason[0]!.toUpperCase()}${sanitizedReason.slice(
            1
          )}. The heuristic anchor is concrete enough to inspect source for the current bucket before reading raw traceback.`
        }
      }
    });
  }

  const shouldZoomFirst = args.request.detail !== "verbose";

  return buildTestStatusDiagnoseContract({
    input: args.input,
    analysis: args.analysis,
    resolvedTests: args.baseDecision.contract.resolved_tests,
    remainingTests: args.baseDecision.contract.remaining_tests,
    remainingMode: args.request.testStatusContext?.remainingMode,
    contractOverrides: {
      ...args.baseDecision.contract,
      diagnosis_complete: false,
      raw_needed: true,
      additional_source_read_likely_low_value: false,
      read_raw_only_if: shouldZoomFirst
        ? "the provider follow-up failed and one deeper sift pass still is not enough"
        : "the provider follow-up failed and you still need exact traceback lines",
      decision: shouldZoomFirst ? "zoom" : "read_raw",
      provider_used: true,
      provider_confidence: null,
      provider_failed: true,
      raw_slice_used: args.rawSliceUsed,
      raw_slice_strategy: args.rawSliceStrategy,
      next_best_action: {
        code: shouldZoomFirst ? "insufficient_signal" : "read_raw_for_exact_traceback",
        bucket_index:
          args.baseDecision.contract.dominant_blocker_bucket_index ??
          args.baseDecision.contract.main_buckets[0]?.bucket_index ??
          null,
        note: shouldZoomFirst
          ? `${sanitizedReason[0]!.toUpperCase()}${sanitizedReason.slice(
              1
            )}. Use one deeper sift pass on the same cached output before reading raw traceback lines.`
          : `${sanitizedReason[0]!.toUpperCase()}${sanitizedReason.slice(
              1
            )}. Read raw traceback only if exact stack lines are still needed.`
      }
    }
  });
}

async function runSiftCore(request: RunRequest, recorder?: RunStatsRecorder): Promise<string> {
  const prepared = prepareInput(request.stdin, request.config.input);
  const heuristicInput = prepared.redacted;
  const heuristicInputTruncated = false;
  const heuristicPrepared = {
    ...prepared,
    truncated: heuristicInput,
    meta: {
      ...prepared.meta,
      finalLength: heuristicInput.length,
      truncatedApplied: heuristicInputTruncated
    }
  };
  const provider = createProvider(request.config);
  const hasTestStatusSignal =
    request.policyName === "test-status" && hasRecognizableTestStatusSignal(heuristicInput);
  const testStatusAnalysis = hasTestStatusSignal ? analyzeTestStatus(heuristicInput) : null;
  const useCompactTestStatusOutput =
    hasTestStatusSignal && testStatusAnalysis
      ? shouldUseCompactTestStatusBypass({
          request,
          analysis: testStatusAnalysis
        })
      : false;
  const testStatusDecision =
    hasTestStatusSignal && testStatusAnalysis && !useCompactTestStatusOutput
      ? buildTestStatusDiagnoseContract({
          input: heuristicInput,
          analysis: testStatusAnalysis,
          resolvedTests: request.testStatusContext?.resolvedTests,
          remainingTests: request.testStatusContext?.remainingTests,
          remainingMode: request.testStatusContext?.remainingMode
        })
      : null;
  const testStatusHeuristicOutput = testStatusDecision
    ? renderTestStatusDecisionOutput({
        request,
        decision: testStatusDecision
      })
    : useCompactTestStatusOutput
      ? applyHeuristicPolicy("test-status", heuristicInput, "standard")
      : null;

  if (request.config.runtime.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} provider=${provider.name} model=${request.config.provider.model} base_url=${request.config.provider.baseUrl} input_chars=${prepared.meta.finalLength}\n`
    );
  }

  const heuristicOutput =
    request.policyName === "test-status"
      ? useCompactTestStatusOutput
        ? testStatusHeuristicOutput
        : testStatusDecision?.contract.diagnosis_complete
          ? testStatusHeuristicOutput
          : null
      : applyHeuristicPolicy(request.policyName, heuristicInput, request.detail);

  if (heuristicOutput) {
    if (request.config.runtime.verbose) {
      process.stderr.write(`${pc.dim("sift")} heuristic=${request.policyName}\n`);
    }

    const heuristicPrompt = buildPrompt({
      question: request.question,
      format: request.format,
      goal: request.goal,
      input: heuristicInput,
      detail: request.detail,
      policyName: request.policyName,
        outputContract:
        request.policyName === "test-status" &&
        request.goal === "diagnose" &&
        request.format === "json"
          ? request.outputContract ?? TEST_STATUS_DIAGNOSE_JSON_CONTRACT
          : request.outputContract,
      analysisContext: [
        request.analysisContext,
        testStatusDecision
          ? buildTestStatusAnalysisContext({
              contract: testStatusDecision.contract,
              includeTestIds: request.includeTestIds,
              remainingSubsetAvailable: request.testStatusContext?.remainingSubsetAvailable
            })
          : undefined
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n\n")
    });

    if (request.dryRun) {
      return buildDryRunOutput({
        request,
        providerName: provider.name,
        prompt: heuristicPrompt.prompt,
        responseMode: heuristicPrompt.responseMode,
        prepared,
        heuristicInput: {
          length: heuristicInput.length,
          truncatedApplied: heuristicInputTruncated,
          strategy: "full-redacted"
        },
        heuristicOutput,
        strategy: "heuristic"
      });
    }

    const finalOutput = withInsufficientHint({
      output: heuristicOutput,
      request,
      prepared
    });
    if (testStatusDecision) {
      logVerboseTestStatusTelemetry({
        request,
        prepared,
        heuristicInputChars: heuristicInput.length,
        heuristicInputTruncated,
        contract: testStatusDecision.contract,
        finalOutput
      });
    }
    recorder?.heuristic();
    return finalOutput;
  }

  if (testStatusDecision && testStatusAnalysis) {
    const rawSlice = buildTestStatusRawSlice({
      input: prepared.redacted,
      config: request.config.input,
      contract: testStatusDecision.contract
    });
    const prompt = buildPrompt({
      question:
        "Complete the diagnosis. Use the heuristic extract as the bucket truth and only change the decision when the sliced command output proves it.",
      format: "json",
      goal: "diagnose",
      input: rawSlice.text,
      detail: request.detail,
      policyName: "test-status",
      outputContract: TEST_STATUS_PROVIDER_SUPPLEMENT_JSON_CONTRACT,
      analysisContext: [
        request.analysisContext,
        buildTestStatusAnalysisContext({
          contract: {
            ...testStatusDecision.contract,
            provider_used: true,
            provider_failed: false,
            raw_slice_used: rawSlice.used,
            raw_slice_strategy: rawSlice.strategy
          },
          includeTestIds: request.includeTestIds,
          remainingSubsetAvailable: request.testStatusContext?.remainingSubsetAvailable
        })
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n\n")
    });
    const providerPrepared = {
      ...prepared,
      truncated: rawSlice.text,
      meta: {
        ...prepared.meta,
        finalLength: rawSlice.text.length,
        truncatedApplied: rawSlice.used || prepared.meta.truncatedApplied
      }
    };

    if (request.dryRun) {
      return buildDryRunOutput({
      request,
      providerName: provider.name,
      prompt: prompt.prompt,
      responseMode: prompt.responseMode,
      prepared: providerPrepared,
      heuristicInput: {
        length: heuristicInput.length,
        truncatedApplied: heuristicInputTruncated,
        strategy: "full-redacted"
      },
      heuristicOutput: testStatusHeuristicOutput,
      strategy: "hybrid"
    });
  }

    try {
      const result = await generateWithRetry({
        provider,
        request,
        prompt: prompt.prompt,
        responseMode: prompt.responseMode
      });
      const supplement = parseTestStatusProviderSupplement(result.text);
      const mergedDecision = buildTestStatusDiagnoseContract({
        input: heuristicInput,
        analysis: testStatusAnalysis,
        resolvedTests: request.testStatusContext?.resolvedTests,
        remainingTests: request.testStatusContext?.remainingTests,
        remainingMode: request.testStatusContext?.remainingMode,
        providerBucketSupplements: supplement.bucket_supplements,
        contractOverrides: {
          diagnosis_complete: supplement.diagnosis_complete,
          raw_needed: supplement.raw_needed,
          additional_source_read_likely_low_value:
            supplement.additional_source_read_likely_low_value,
          read_raw_only_if: supplement.read_raw_only_if,
          decision: supplement.decision,
          provider_used: true,
          provider_confidence: supplement.provider_confidence,
          provider_failed: false,
          raw_slice_used: rawSlice.used,
          raw_slice_strategy: rawSlice.strategy,
          next_best_action: supplement.next_best_action
        }
      });
      const finalOutput = renderTestStatusDecisionOutput({
        request,
        decision: mergedDecision
      });
      logVerboseTestStatusTelemetry({
        request,
        prepared,
        heuristicInputChars: heuristicInput.length,
        heuristicInputTruncated,
        contract: mergedDecision.contract,
        finalOutput,
        rawSliceChars: rawSlice.text.length,
        providerInputChars: providerPrepared.truncated.length,
        providerOutputChars: result.text.length
      });
      recorder?.provider(result.usage);
      return finalOutput;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_error";
      const failureDecision = buildTestStatusProviderFailureDecision({
        request,
        baseDecision: testStatusDecision,
        input: heuristicInput,
        analysis: testStatusAnalysis,
        reason,
        rawSliceUsed: rawSlice.used,
        rawSliceStrategy: rawSlice.strategy
      });

      const finalOutput =
        request.goal === "diagnose" && request.format === "json"
          ? JSON.stringify(
              buildTestStatusPublicDiagnoseContract({
                contract: failureDecision.contract,
                includeTestIds: request.includeTestIds,
                remainingSubsetAvailable: request.testStatusContext?.remainingSubsetAvailable
              }),
              null,
              2
            )
          : renderTestStatusDecisionOutput({
        request,
        decision: failureDecision
      });
      logVerboseTestStatusTelemetry({
        request,
        prepared,
        heuristicInputChars: heuristicInput.length,
        heuristicInputTruncated,
        contract: failureDecision.contract,
        finalOutput,
        rawSliceChars: rawSlice.text.length,
        providerInputChars: providerPrepared.truncated.length
      });
      recorder?.fallback();
      return finalOutput;
    }
  }

  const genericRawSlice = buildGenericRawSlice({
    input: prepared.redacted,
    config: request.config.input
  });
  const providerPrompt = buildPrompt({
    question: request.question,
    format: request.format,
    goal: request.goal,
    input: genericRawSlice.text,
    detail: request.detail,
    policyName: request.policyName,
    outputContract: request.outputContract,
    analysisContext: request.analysisContext
  });
  const providerPrepared = {
    ...prepared,
    truncated: genericRawSlice.text,
    meta: {
      ...prepared.meta,
      finalLength: genericRawSlice.text.length,
      truncatedApplied: genericRawSlice.used || prepared.meta.truncatedApplied
    }
  };

  if (request.dryRun) {
    return buildDryRunOutput({
      request,
      providerName: provider.name,
      prompt: providerPrompt.prompt,
      responseMode: providerPrompt.responseMode,
      prepared: providerPrepared,
      heuristicInput: {
        length: heuristicInput.length,
        truncatedApplied: heuristicInputTruncated,
        strategy: "full-redacted"
      },
      heuristicOutput: testStatusDecision ? testStatusHeuristicOutput : null,
      strategy: testStatusDecision ? "hybrid" : "provider"
    });
  }

  try {
    const result = await generateWithRetry({
      provider,
      request,
      prompt: providerPrompt.prompt,
      responseMode: providerPrompt.responseMode
    });

    if (
      looksLikeRejectedModelOutput({
        source: genericRawSlice.text,
        candidate: result.text,
        responseMode: providerPrompt.responseMode
      })
    ) {
      throw new Error("Model output rejected by quality gate");
    }

    recorder?.provider(result.usage);
    return withInsufficientHint({
      output: normalizeOutput(result.text, providerPrompt.responseMode),
      request,
      prepared: providerPrepared
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    recorder?.fallback();
    return withInsufficientHint({
      output: buildFallbackOutput({
        format: request.format,
        reason,
        rawInput: providerPrepared.truncated,
        rawFallback: request.config.runtime.rawFallback,
        jsonFallback: request.fallbackJson
      }),
      request,
      prepared: providerPrepared
    });
  }
}

export async function runSift(request: RunRequest): Promise<string> {
  return runSiftCore(request);
}

export async function runSiftWithStats(request: RunRequest): Promise<RunResult> {
  if (request.dryRun) {
    return {
      output: await runSiftCore(request),
      stats: null
    };
  }

  const startedAt = Date.now();
  let layer: RunStats["layer"] = "fallback";
  let providerCalled = false;
  let totalTokens: number | null = null;

  const output = await runSiftCore(request, {
    heuristic() {
      layer = "heuristic";
      providerCalled = false;
      totalTokens = null;
    },
    provider(usage) {
      layer = "provider";
      providerCalled = true;
      totalTokens = usage?.totalTokens ?? null;
    },
    fallback() {
      layer = "fallback";
      providerCalled = true;
      totalTokens = null;
    }
  });

  return {
    output,
    stats: {
      layer,
      providerCalled,
      totalTokens,
      durationMs: Date.now() - startedAt,
      presetName: request.presetName
    }
  };
}
