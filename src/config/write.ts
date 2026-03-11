import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  DEFAULT_CONFIG_FILENAME,
  getDefaultGlobalConfigPath
} from "../constants.js";
import { defaultConfig } from "./defaults.js";
import type { SiftConfig } from "../types.js";

export function writeExampleConfig(options: {
  targetPath?: string;
  global?: boolean;
} = {}): string {
  if (options.global && options.targetPath) {
    throw new Error("Use either --path <path> or --global, not both.");
  }

  const resolved = options.global
    ? getDefaultGlobalConfigPath()
    : path.resolve(options.targetPath ?? DEFAULT_CONFIG_FILENAME);

  if (fs.existsSync(resolved)) {
    throw new Error(`Config file already exists at ${resolved}`);
  }

  const yaml = YAML.stringify(defaultConfig);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, yaml, "utf8");
  return resolved;
}

export function writeConfigFile(options: {
  targetPath: string;
  config: SiftConfig;
  overwrite?: boolean;
}): string {
  const resolved = path.resolve(options.targetPath);

  if (!options.overwrite && fs.existsSync(resolved)) {
    throw new Error(`Config file already exists at ${resolved}`);
  }

  const yaml = YAML.stringify(options.config);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, yaml, {
    encoding: "utf8",
    mode: 0o600
  });

  try {
    fs.chmodSync(resolved, 0o600);
  } catch {
    // Ignore permission enforcement failures on platforms that do not support chmod.
  }

  return resolved;
}
