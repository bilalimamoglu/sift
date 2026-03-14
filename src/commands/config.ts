import { findConfigPath } from "../config/load.js";
import {
  applyActiveProvider,
  preserveActiveNativeProviderProfile,
  getStoredProviderProfile
} from "../config/native-provider.js";
import { getNativeProviderApiKeyEnvName } from "../config/provider-api-key.js";
import { resolveConfig } from "../config/resolve.js";
import { writeExampleConfig, writeConfigFile } from "../config/write.js";
import { loadEditableConfig } from "../config/editable.js";
import { createPresentation } from "../ui/presentation.js";
export { configSetup, resolveSetupPath } from "./config-setup.js";
import type { NativeProviderName } from "../types.js";

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

function isNativeProviderName(value: string): value is NativeProviderName {
  return value === "openai" || value === "openrouter";
}

export function configUse(
  provider: string,
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!isNativeProviderName(provider)) {
    throw new Error(`Unsupported config provider: ${provider}`);
  }

  const { config, existed, resolvedPath } = loadEditableConfig(configPath);
  const preservedConfig = preserveActiveNativeProviderProfile(config);
  const storedProfile = getStoredProviderProfile(preservedConfig, provider);
  const envName = getNativeProviderApiKeyEnvName(provider);
  const envKey = env[envName];

  if (!storedProfile?.apiKey && !envKey) {
    throw new Error(
      `No saved ${provider} API key or ${envName} found. Run 'sift config setup' first.`
    );
  }

  const nextConfig = applyActiveProvider(
    preservedConfig,
    provider,
    storedProfile,
    storedProfile?.apiKey ?? ""
  );
  writeConfigFile({
    targetPath: resolvedPath,
    config: nextConfig,
    overwrite: existed
  });

  const message = `Switched active provider to ${provider} (${resolvedPath}).`;
  if (!process.stdout.isTTY) {
    process.stdout.write(`${message}\n`);
    if (!storedProfile?.apiKey && envKey) {
      process.stdout.write(
        `Using ${envName} from the environment. No API key was written to config.\n`
      );
    }
    return;
  }

  const ui = createPresentation(true);
  process.stdout.write(`${ui.success(message)}\n`);
  if (!storedProfile?.apiKey && envKey) {
    process.stdout.write(
      `${ui.note(`Using ${envName} from the environment. No API key was written to config.`)}\n`
    );
  }
}
