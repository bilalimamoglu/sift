import type { PresetDefinition, SiftConfig } from "../types.js";

export function getPreset(config: SiftConfig, name: string): PresetDefinition {
  const preset = config.presets[name];
  if (!preset) {
    throw new Error(`Unknown preset: ${name}`);
  }

  return preset;
}
