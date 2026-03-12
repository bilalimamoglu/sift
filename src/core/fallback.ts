import type { OutputFormat } from "../types.js";
import { isRetriableReason } from "./quality.js";

const RAW_FALLBACK_SLICE = 1_200;

function buildStructuredError(reason: string) {
  return {
    status: "error" as const,
    reason,
    retriable: isRetriableReason(reason),
    provider_failed: true,
    raw_needed: true,
    why_raw_needed: "Provider follow-up failed, so the reduced answer may still need exact raw evidence."
  };
}

export function buildFallbackOutput(args: {
  format: OutputFormat;
  reason: string;
  rawInput: string;
  rawFallback: boolean;
  jsonFallback?: unknown;
}): string {
  if (args.format === "verdict") {
    return JSON.stringify(
      {
        ...buildStructuredError(args.reason),
        verdict: "unclear",
        reason: `Sift fallback: ${args.reason}`,
        evidence: []
      },
      null,
      2
    );
  }

  if (args.format === "json") {
    return JSON.stringify(buildStructuredError(args.reason), null, 2);
  }

  const prefix = `Sift fallback triggered (${args.reason}).`;
  const rawHint = "Raw may still be needed because provider follow-up failed.";

  if (!args.rawFallback) {
    return `${prefix} ${rawHint}`;
  }

  return [prefix, rawHint, "", args.rawInput.slice(-RAW_FALLBACK_SLICE)].join("\n");
}
