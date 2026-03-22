import type { InputConfig, PreparedInput, SafetyConfig } from "../types.js";
import { redactInput } from "./redact.js";
import { applySafetyHardening } from "./safety.js";
import { sanitizeInput } from "./sanitize.js";
import { truncateInput } from "./truncate.js";

export function prepareInput(
  raw: string,
  config: InputConfig,
  safetyConfig: SafetyConfig
): PreparedInput {
  const sanitized = sanitizeInput(raw, config.stripAnsi);
  const redacted =
    config.redact || config.redactStrict
      ? redactInput(sanitized, { strict: config.redactStrict })
      : sanitized;
  const hardened = applySafetyHardening(redacted, safetyConfig);
  const truncated = truncateInput(hardened.text, {
    maxInputChars: config.maxInputChars,
    headChars: config.headChars,
    tailChars: config.tailChars
  });

  return {
    raw,
    sanitized,
    redacted: hardened.text,
    truncated: truncated.text,
    safety: hardened.report,
    meta: {
      originalLength: raw.length,
      finalLength: truncated.text.length,
      redactionApplied: config.redact || config.redactStrict,
      truncatedApplied: truncated.truncatedApplied
    }
  };
}
