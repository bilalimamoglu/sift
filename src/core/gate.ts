import type { OutputFormat } from "../types.js";

const FAIL_ON_SUPPORTED_PRESETS = new Set(["infra-risk", "audit-critical"]);

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

export function supportsFailOnPreset(
  presetName: string | undefined
): presetName is "infra-risk" | "audit-critical" {
  return typeof presetName === "string" && FAIL_ON_SUPPORTED_PRESETS.has(presetName);
}

export function assertSupportedFailOnPreset(
  presetName: string | undefined
): asserts presetName is "infra-risk" | "audit-critical" {
  if (!supportsFailOnPreset(presetName)) {
    throw new Error(
      "--fail-on is supported only for built-in presets: infra-risk, audit-critical."
    );
  }
}

export function assertSupportedFailOnFormat(args: {
  presetName: "infra-risk" | "audit-critical";
  format: OutputFormat;
}): void {
  const expectedFormat =
    args.presetName === "infra-risk" ? "verdict" : "json";

  if (args.format !== expectedFormat) {
    throw new Error(
      `--fail-on requires the default ${expectedFormat} format for preset ${args.presetName}.`
    );
  }
}

export function evaluateGate(args: {
  presetName: string;
  output: string;
}): { shouldFail: boolean } {
  const parsed = parseJson(args.output) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return { shouldFail: false };
  }

  if (args.presetName === "infra-risk") {
    return {
      shouldFail: parsed["verdict"] === "fail"
    };
  }

  if (args.presetName === "audit-critical") {
    const status = parsed["status"];
    const vulnerabilities = parsed["vulnerabilities"];

    return {
      shouldFail:
        status === "ok" &&
        Array.isArray(vulnerabilities) &&
        vulnerabilities.length > 0
    };
  }

  return { shouldFail: false };
}
