import { findConfigPath } from "../config/load.js";
import { resolveConfig } from "../config/resolve.js";
import { writeExampleConfig } from "../config/write.js";
import { createPresentation } from "../ui/presentation.js";
export { configSetup, resolveSetupPath } from "./config-setup.js";

const MASKED_SECRET = "***";

export function maskConfigSecrets(value: unknown): unknown {
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

export function configInit(targetPath?: string, global = false): void {
  const path = writeExampleConfig({
    targetPath,
    global
  });

  if (!process.stdout.isTTY) {
    process.stdout.write(`${path}\n`);
    return;
  }

  const ui = createPresentation(true);
  process.stdout.write(
    `${ui.success(`${global ? "Machine-wide" : "Template"} config written to ${path}`)}\n`
  );
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
  const message = `Resolved config is valid${resolvedPath ? ` (${resolvedPath})` : " (using defaults)" }.`;

  if (!process.stdout.isTTY) {
    process.stdout.write(`${message}\n`);
    return;
  }

  const ui = createPresentation(true);
  process.stdout.write(`${ui.success(message)}\n`);
}
