import { findConfigPath } from "../config/load.js";
import { resolveConfig } from "../config/resolve.js";
import { writeExampleConfig } from "../config/write.js";

export function configInit(targetPath?: string): void {
  const path = writeExampleConfig(targetPath);
  process.stdout.write(`${path}\n`);
}

export function configShow(configPath?: string): void {
  const config = resolveConfig({
    configPath,
    env: process.env
  });
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
}

export function configValidate(configPath?: string): void {
  resolveConfig({
    configPath,
    env: process.env
  });

  const resolvedPath = findConfigPath(configPath);
  process.stdout.write(
    `Config is valid${resolvedPath ? ` (${resolvedPath})` : " (using defaults)" }.\n`
  );
}
