import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getDefaultConfigSearchPaths } from "../constants.js";

export function findConfigPath(explicitPath?: string): string | null {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }

    return resolved;
  }

  for (const candidate of getDefaultConfigSearchPaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadRawConfig(explicitPath?: string): unknown {
  const configPath = findConfigPath(explicitPath);
  if (!configPath) {
    return {};
  }

  const content = fs.readFileSync(configPath, "utf8");
  return YAML.parse(content) ?? {};
}
