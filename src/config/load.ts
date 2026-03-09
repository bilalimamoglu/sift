import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CONFIG_SEARCH_PATHS } from "../constants.js";

export function findConfigPath(explicitPath?: string): string | null {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    return fs.existsSync(resolved) ? resolved : null;
  }

  for (const candidate of DEFAULT_CONFIG_SEARCH_PATHS) {
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
