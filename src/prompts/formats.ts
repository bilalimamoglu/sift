import {
  GENERIC_JSON_CONTRACT,
  INSUFFICIENT_SIGNAL_TEXT
} from "../constants.js";
import type { OutputFormat, ResponseMode } from "../types.js";

export interface GenericFormatPolicy {
  responseMode: ResponseMode;
  outputContract?: string;
  taskRules: string[];
}

export function getGenericFormatPolicy(
  format: OutputFormat,
  outputContract?: string
): GenericFormatPolicy {
  switch (format) {
    case "brief":
      return {
        responseMode: "text",
        taskRules: [
          "Return 1 to 3 short sentences.",
          `If the evidence is insufficient, reply exactly with: ${INSUFFICIENT_SIGNAL_TEXT}`
        ]
      };
    case "bullets":
      return {
        responseMode: "text",
        taskRules: [
          "Return at most 5 short lines prefixed with '- '.",
          `If the evidence is insufficient, reply exactly with: ${INSUFFICIENT_SIGNAL_TEXT}`
        ]
      };
    case "verdict":
      return {
        responseMode: "json",
        outputContract:
          '{"verdict":"pass|fail|unclear","reason":string,"evidence":string[]}',
        taskRules: [
          "Return only valid JSON.",
          'Use this exact contract: {"verdict":"pass|fail|unclear","reason":string,"evidence":string[]}.',
          'Return "fail" when the input contains explicit destructive, risky, or clearly unsafe signals.',
          'Return "pass" only when the input clearly supports safety or successful completion.',
          'Treat destroy, delete, drop, recreate, replace, revoke, deny, downtime, data loss, IAM risk, and network exposure as important risk signals.',
          `If evidence is insufficient, set verdict to "unclear" and reason to "${INSUFFICIENT_SIGNAL_TEXT}".`
        ]
      };
    case "json":
      return {
        responseMode: "json",
        outputContract: outputContract ?? GENERIC_JSON_CONTRACT,
        taskRules: [
          "Return only valid JSON.",
          `Use this exact contract: ${outputContract ?? GENERIC_JSON_CONTRACT}.`,
          `If evidence is insufficient, keep the schema valid and use "${INSUFFICIENT_SIGNAL_TEXT}" in the primary explanatory field.`
        ]
      };
  }
}
