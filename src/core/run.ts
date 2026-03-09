import pc from "picocolors";
import type { RunRequest } from "../types.js";
import { createProvider } from "../providers/factory.js";
import { buildPrompt } from "../prompts/buildPrompt.js";
import { buildFallbackOutput } from "./fallback.js";
import { applyHeuristicPolicy } from "./heuristics.js";
import { prepareInput } from "./pipeline.js";
import { isRetriableReason, looksLikeRejectedModelOutput } from "./quality.js";

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
}): string {
  return JSON.stringify(
    {
      status: "dry-run",
      strategy: args.heuristicOutput ? "heuristic" : "provider",
      provider: {
        name: args.providerName,
        model: args.request.config.provider.model,
        baseUrl: args.request.config.provider.baseUrl,
        jsonResponseFormat: args.request.config.provider.jsonResponseFormat
      },
      question: args.request.question,
      format: args.request.format,
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

async function generateWithRetry(args: {
  provider: ReturnType<typeof createProvider>;
  request: RunRequest;
  prompt: string;
  responseMode: "text" | "json";
}): Promise<Awaited<ReturnType<ReturnType<typeof createProvider>["generate"]>>> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await args.provider.generate({
        model: args.request.config.provider.model,
        prompt: args.prompt,
        temperature: args.request.config.provider.temperature,
        maxOutputTokens: args.request.config.provider.maxOutputTokens,
        timeoutMs: args.request.config.provider.timeoutMs,
        responseMode: args.responseMode,
        jsonResponseFormat: args.request.config.provider.jsonResponseFormat
      });
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.message : "unknown_error";

      if (attempt > 0 || !isRetriableReason(reason)) {
        throw error;
      }

      if (args.request.config.runtime.verbose) {
        process.stderr.write(
          `${pc.dim("sift")} retry=1 reason=${reason} delay_ms=${RETRY_DELAY_MS}\n`
        );
      }

      await delay(RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("unknown_error");
}

export async function runSift(request: RunRequest): Promise<string> {
  const prepared = prepareInput(request.stdin, request.config.input);
  const { prompt, responseMode } = buildPrompt({
    question: request.question,
    format: request.format,
    input: prepared.truncated,
    policyName: request.policyName,
    outputContract: request.outputContract
  });

  const provider = createProvider(request.config);

  if (request.config.runtime.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} provider=${provider.name} model=${request.config.provider.model} base_url=${request.config.provider.baseUrl} input_chars=${prepared.meta.finalLength}\n`
    );
  }

  const heuristicOutput = applyHeuristicPolicy(
    request.policyName,
    prepared.truncated
  );

  if (heuristicOutput) {
    if (request.config.runtime.verbose) {
      process.stderr.write(`${pc.dim("sift")} heuristic=${request.policyName}\n`);
    }

    if (request.dryRun) {
      return buildDryRunOutput({
        request,
        providerName: provider.name,
        prompt,
        responseMode,
        prepared,
        heuristicOutput
      });
    }

    return heuristicOutput;
  }

  if (request.dryRun) {
    return buildDryRunOutput({
      request,
      providerName: provider.name,
      prompt,
      responseMode,
      prepared,
      heuristicOutput: null
    });
  }

  try {
    const result = await generateWithRetry({
      provider,
      request,
      prompt,
      responseMode
    });

    if (
      looksLikeRejectedModelOutput({
        source: prepared.truncated,
        candidate: result.text,
        responseMode
      })
    ) {
      throw new Error("Model output rejected by quality gate");
    }

    return normalizeOutput(result.text, responseMode);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    return buildFallbackOutput({
      format: request.format,
      reason,
      rawInput: prepared.truncated,
      rawFallback: request.config.runtime.rawFallback,
      jsonFallback: request.fallbackJson
    });
  }
}
