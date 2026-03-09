import { INSUFFICIENT_SIGNAL_TEXT } from "../constants.js";
import type { ResponseMode } from "../types.js";

const META_PATTERNS = [
  /please provide/i,
  /need more (?:input|context|information|details)/i,
  /provided command output/i,
  /based on the provided/i,
  /as an ai/i,
  /here(?:'s| is) (?:the )?(?:json|answer)/i,
  /cannot determine without/i
];

function normalizeForComparison(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRetriableReason(reason: string): boolean {
  return /timed out|http 408|http 409|http 425|http 429|http 5\d\d|network/i.test(
    reason.toLowerCase()
  );
}

export function looksLikeRejectedModelOutput(args: {
  source: string;
  candidate: string;
  responseMode: ResponseMode;
}): boolean {
  const source = normalizeForComparison(args.source);
  const candidate = normalizeForComparison(args.candidate);

  if (!candidate) {
    return true;
  }

  if (candidate === INSUFFICIENT_SIGNAL_TEXT) {
    return false;
  }

  if (candidate.includes("```")) {
    return true;
  }

  if (META_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return true;
  }

  if (args.responseMode === "json") {
    const trimmed = args.candidate.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return true;
    }
  }

  if (source.length >= 800 && candidate.length > source.length * 0.8) {
    return true;
  }

  if (source.length > 0 && source.length < 800 && candidate.length > source.length + 160) {
    return true;
  }

  return false;
}
