import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CONFIG_FILENAME } from "../constants.js";
import { defaultConfig } from "./defaults.js";

export function writeExampleConfig(targetPath?: string): string {
  const resolved = path.resolve(targetPath ?? DEFAULT_CONFIG_FILENAME);
  if (fs.existsSync(resolved)) {
    throw new Error(`Config file already exists at ${resolved}`);
  }

  const yaml = YAML.stringify(defaultConfig);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, yaml, "utf8");
  return resolved;
}
