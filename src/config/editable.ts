import fs from "node:fs";
import path from "node:path";
import { getDefaultGlobalConfigPath } from "../constants.js";
import { defaultConfig } from "./defaults.js";
import { findConfigPath, loadRawConfig } from "./load.js";
import { mergeDefined } from "./resolve.js";
import { siftConfigSchema } from "./schema.js";
import type { SiftConfig } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface EditableConfigResult {
  config: SiftConfig;
  existed: boolean;
  resolvedPath: string;
}

export function resolveEditableConfigPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  return findConfigPath() ?? getDefaultGlobalConfigPath();
}

export function loadEditableConfig(explicitPath?: string): EditableConfigResult {
  const resolvedPath = resolveEditableConfigPath(explicitPath);
  const existed = fs.existsSync(resolvedPath);
  const rawConfig = existed ? loadRawConfig(resolvedPath) : {};
  const config = siftConfigSchema.parse(
    mergeDefined(defaultConfig, isRecord(rawConfig) ? rawConfig : {})
  );

  return {
    config,
    existed,
    resolvedPath
  };
}
