import { findConfigPath } from "../config/load.js";
import { resolveConfig } from "../config/resolve.js";
import { writeExampleConfig } from "../config/write.js";

const MASKED_SECRET = "***";

function maskConfigSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskConfigSecrets);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "apiKey" && typeof entry === "string" && entry.length > 0) {
      output[key] = MASKED_SECRET;
      continue;
    }

    output[key] = maskConfigSecrets(entry);
  }

  return output;
}

export function configInit(targetPath?: string): void {
  const path = writeExampleConfig(targetPath);
  process.stdout.write(`${path}\n`);
}

export function configShow(configPath?: string, showSecrets = false): void {
  const config = resolveConfig({
    configPath,
    env: process.env
  });
  const printable = showSecrets ? config : maskConfigSecrets(config);
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
}

export function configValidate(configPath?: string): void {
  resolveConfig({
    configPath,
    env: process.env
  });

  const resolvedPath = findConfigPath(configPath);
  process.stdout.write(
    `Resolved config is valid${resolvedPath ? ` (${resolvedPath})` : " (using defaults)" }.\n`
  );
}
