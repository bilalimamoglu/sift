import { getProviderApiKeyEnvNames } from "../config/provider-api-key.js";
import type { SiftConfig } from "../types.js";
import { createPresentation } from "../ui/presentation.js";

export function runDoctor(config: SiftConfig, configPath?: string | null): number {
  const ui = createPresentation(Boolean(process.stdout.isTTY));
  const lines = [
    "sift doctor",
    "A quick check for your local setup.",
    "mode: local config completeness check",
    ui.labelValue("configPath", configPath ?? "(defaults only)"),
    ui.labelValue("provider", config.provider.provider),
    ui.labelValue("model", config.provider.model),
    ui.labelValue("baseUrl", config.provider.baseUrl),
    ui.labelValue("apiKey", config.provider.apiKey ? "set" : "not set"),
    ui.labelValue("maxCaptureChars", String(config.input.maxCaptureChars)),
    ui.labelValue("maxInputChars", String(config.input.maxInputChars)),
    ui.labelValue("rawFallback", String(config.runtime.rawFallback))
  ];

  process.stdout.write(`${lines.join("\n")}\n`);

  const problems: string[] = [];

  if (!config.provider.baseUrl) {
    problems.push("Missing provider.baseUrl");
  }

  if (!config.provider.model) {
    problems.push("Missing provider.model");
  }

  if (
    (config.provider.provider === "openai" ||
      config.provider.provider === "openai-compatible" ||
      config.provider.provider === "openrouter") &&
    !config.provider.apiKey
  ) {
    problems.push("Missing provider.apiKey");
    problems.push(
      `Set one of: ${getProviderApiKeyEnvNames(
        config.provider.provider,
        config.provider.baseUrl
      ).join(", ")}`
    );
  }

  if (problems.length > 0) {
    if (process.stderr.isTTY) {
      const errorUi = createPresentation(true);
      process.stderr.write(
        `${problems.map((problem) => errorUi.error(problem)).join("\n")}\n`
      );
    } else {
      process.stderr.write(`${problems.join("\n")}\n`);
    }
    return 1;
  }

  return 0;
}
