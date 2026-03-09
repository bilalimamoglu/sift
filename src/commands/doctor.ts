import { getProviderApiKeyEnvNames } from "../config/provider-api-key.js";
import type { SiftConfig } from "../types.js";

export function runDoctor(config: SiftConfig): number {
  const lines = [
    "sift doctor",
    "mode: local config completeness check",
    `provider: ${config.provider.provider}`,
    `model: ${config.provider.model}`,
    `baseUrl: ${config.provider.baseUrl}`,
    `apiKey: ${config.provider.apiKey ? "set" : "not set"}`,
    `maxCaptureChars: ${config.input.maxCaptureChars}`,
    `maxInputChars: ${config.input.maxInputChars}`,
    `rawFallback: ${config.runtime.rawFallback}`
  ];

  process.stdout.write(`${lines.join("\n")}\n`);

  const problems: string[] = [];

  if (!config.provider.baseUrl) {
    problems.push("Missing provider.baseUrl");
  }

  if (!config.provider.model) {
    problems.push("Missing provider.model");
  }

  if (config.provider.provider === "openai-compatible" && !config.provider.apiKey) {
    problems.push("Missing provider.apiKey");
    problems.push(
      `Set one of: ${getProviderApiKeyEnvNames(
        config.provider.provider,
        config.provider.baseUrl
      ).join(", ")}`
    );
  }

  if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n`);
    return 1;
  }

  return 0;
}
