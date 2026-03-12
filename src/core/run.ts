import pc from "picocolors";
import type { RunRequest } from "../types.js";
import { createProvider } from "../providers/factory.js";
import { buildPrompt } from "../prompts/buildPrompt.js";
import { buildFallbackOutput } from "./fallback.js";
import { analyzeTestStatus, applyHeuristicPolicy } from "./heuristics.js";
import {
  buildInsufficientSignalOutput,
  isInsufficientSignalOutput
} from "./insufficient.js";
import { prepareInput } from "./pipeline.js";
import { isRetriableReason, looksLikeRejectedModelOutput } from "./quality.js";
import {
  buildTestStatusAnalysisContext,
  buildTestStatusDiagnoseContract,
  parseTestStatusProviderSupplement,
  TEST_STATUS_DIAGNOSE_JSON_CONTRACT,
  TEST_STATUS_PROVIDER_SUPPLEMENT_JSON_CONTRACT,
  type TestStatusDiagnoseContract
} from "./testStatusDecision.js";
import { buildGenericRawSlice, buildTestStatusRawSlice } from "./rawSlice.js";

const RETRY_DELAY_MS = 300;

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
    truncatedApplied: args.prepared.meta.truncatedApplied
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

  return generate();
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

function buildTestStatusFallbackContract(args: {
  contract: TestStatusDiagnoseContract;
  reason: string;
}): string {
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
        note: `Provider follow-up failed (${args.reason}). Use focused or verbose detail, then raw only if exact traceback lines are still needed.`
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
    return JSON.stringify(args.decision.contract, null, 2);
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
  const shouldZoomFirst = args.request.detail !== "verbose";

  return buildTestStatusDiagnoseContract({
    input: args.input,
    analysis: args.analysis,
    resolvedTests: args.baseDecision.contract.resolved_tests,
    remainingTests: args.baseDecision.contract.remaining_tests,
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
          ? `Provider follow-up failed (${args.reason}). Use one deeper sift pass on the same cached output before reading raw traceback lines.`
          : `Provider follow-up failed (${args.reason}). Read raw traceback only if exact stack lines are still needed.`
      }
    }
  });
}

export async function runSift(request: RunRequest): Promise<string> {
  const prepared = prepareInput(request.stdin, request.config.input);
  const provider = createProvider(request.config);
  const hasTestStatusSignal =
    request.policyName === "test-status" && hasRecognizableTestStatusSignal(prepared.truncated);
  const testStatusAnalysis = hasTestStatusSignal ? analyzeTestStatus(prepared.truncated) : null;
  const testStatusDecision =
    hasTestStatusSignal && testStatusAnalysis
      ? buildTestStatusDiagnoseContract({
          input: prepared.truncated,
          analysis: testStatusAnalysis,
          resolvedTests: request.testStatusContext?.resolvedTests,
          remainingTests: request.testStatusContext?.remainingTests
        })
      : null;
  const testStatusHeuristicOutput = testStatusDecision
    ? renderTestStatusDecisionOutput({
        request,
        decision: testStatusDecision
      })
    : null;

  if (request.config.runtime.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} provider=${provider.name} model=${request.config.provider.model} base_url=${request.config.provider.baseUrl} input_chars=${prepared.meta.finalLength}\n`
    );
  }

  const heuristicOutput =
    request.policyName === "test-status"
      ? testStatusDecision?.contract.diagnosis_complete
        ? testStatusHeuristicOutput
        : null
      : applyHeuristicPolicy(request.policyName, prepared.truncated, request.detail);

  if (heuristicOutput) {
    if (request.config.runtime.verbose) {
      process.stderr.write(`${pc.dim("sift")} heuristic=${request.policyName}\n`);
    }

    const heuristicPrompt = buildPrompt({
      question: request.question,
      format: request.format,
      goal: request.goal,
      input: prepared.truncated,
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
        testStatusDecision ? buildTestStatusAnalysisContext(testStatusDecision.contract) : undefined
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
        heuristicOutput,
        strategy: "heuristic"
      });
    }

    return withInsufficientHint({
      output: heuristicOutput,
      request,
      prepared
    });
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
          ...testStatusDecision.contract,
          provider_used: true,
          provider_failed: false,
          raw_slice_used: rawSlice.used,
          raw_slice_strategy: rawSlice.strategy
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
        input: prepared.truncated,
        analysis: testStatusAnalysis,
        resolvedTests: request.testStatusContext?.resolvedTests,
        remainingTests: request.testStatusContext?.remainingTests,
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

      return renderTestStatusDecisionOutput({
        request,
        decision: mergedDecision
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_error";
      const failureDecision = buildTestStatusProviderFailureDecision({
        request,
        baseDecision: testStatusDecision,
        input: prepared.truncated,
        analysis: testStatusAnalysis,
        reason,
        rawSliceUsed: rawSlice.used,
        rawSliceStrategy: rawSlice.strategy
      });

      if (request.goal === "diagnose" && request.format === "json") {
        return JSON.stringify(failureDecision.contract, null, 2);
      }

      return renderTestStatusDecisionOutput({
        request,
        decision: failureDecision
      });
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

    return withInsufficientHint({
      output: normalizeOutput(result.text, providerPrompt.responseMode),
      request,
      prepared: providerPrepared
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

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
