import pc from "picocolors";
import type { RunRequest } from "../types.js";
import { createProvider } from "../providers/factory.js";
import { buildPrompt } from "../prompts/buildPrompt.js";
import { buildFallbackOutput } from "./fallback.js";
import { applyHeuristicPolicy } from "./heuristics.js";
import { prepareInput } from "./pipeline.js";
import { looksLikeRejectedModelOutput } from "./quality.js";

function normalizeOutput(text: string, responseMode: "text" | "json"): string {
  if (responseMode !== "json") {
    return text.trim();
  }

  const parsed = JSON.parse(text);
  return JSON.stringify(parsed, null, 2);
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

    return heuristicOutput;
  }

  try {
    const result = await provider.generate({
      model: request.config.provider.model,
      prompt,
      temperature: request.config.provider.temperature,
      maxOutputTokens: request.config.provider.maxOutputTokens,
      timeoutMs: request.config.provider.timeoutMs,
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
