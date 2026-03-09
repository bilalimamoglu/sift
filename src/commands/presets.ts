import type { SiftConfig } from "../types.js";

export function listPresets(config: SiftConfig): void {
  const names = Object.keys(config.presets).sort();
  process.stdout.write(`${names.join("\n")}\n`);
}

export function showPreset(
  config: SiftConfig,
  name: string,
  includeInternal = false
): void {
  const preset = config.presets[name];
  if (!preset) {
    throw new Error(`Unknown preset: ${name}`);
  }

  const output = includeInternal
    ? { name, ...preset }
    : {
        name,
        question: preset.question,
        format: preset.format
      };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
