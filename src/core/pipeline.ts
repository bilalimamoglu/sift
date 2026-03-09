import type { InputConfig, PreparedInput } from "../types.js";
import { redactInput } from "./redact.js";
import { sanitizeInput } from "./sanitize.js";
import { truncateInput } from "./truncate.js";

export function prepareInput(raw: string, config: InputConfig): PreparedInput {
  const sanitized = sanitizeInput(raw, config.stripAnsi);
  const redacted =
    config.redact || config.redactStrict
      ? redactInput(sanitized, { strict: config.redactStrict })
      : sanitized;
  const truncated = truncateInput(redacted, {
    maxInputChars: config.maxInputChars,
    headChars: config.headChars,
    tailChars: config.tailChars
  });

  return {
    raw,
    sanitized,
    redacted,
    truncated: truncated.text,
    meta: {
      originalLength: raw.length,
      finalLength: truncated.text.length,
      redactionApplied: config.redact || config.redactStrict,
      truncatedApplied: truncated.truncatedApplied
    }
  };
}
