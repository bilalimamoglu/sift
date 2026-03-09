import type { SiftConfig } from "../types.js";

export function runDoctor(config: SiftConfig): number {
  const lines = [
    "sift doctor",
    `provider: ${config.provider.provider}`,
    `model: ${config.provider.model}`,
    `baseUrl: ${config.provider.baseUrl}`,
    `apiKey: ${config.provider.apiKey ? "set" : "not set (may be optional for your backend)"}`,
    `maxCaptureChars: ${config.input.maxCaptureChars}`,
    `maxInputChars: ${config.input.maxInputChars}`,
    `rawFallback: ${config.runtime.rawFallback}`
  ];

  process.stdout.write(`${lines.join("\n")}\n`);

  if (!config.provider.baseUrl) {
    process.stderr.write("Missing provider.baseUrl\n");
    return 1;
  }

  if (!config.provider.model) {
    process.stderr.write("Missing provider.model\n");
    return 1;
  }

  return 0;
}
