import { defaultConfig } from "./defaults.js";
import { loadRawConfig } from "./load.js";
import { siftConfigSchema } from "./schema.js";
import type { PartialSiftConfig, SiftConfig } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDefined<T>(base: T, override: unknown): T {
  if (!isRecord(override)) {
    return base;
  }

  const result: Record<string, unknown> = isRecord(base) ? { ...base } : {};

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const existing = result[key];

    if (isRecord(existing) && isRecord(value)) {
      result[key] = mergeDefined(existing, value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

function buildEnvOverrides(env: NodeJS.ProcessEnv): PartialSiftConfig {
  const overrides: PartialSiftConfig = {};

  if (
    env.SIFT_PROVIDER ||
    env.SIFT_MODEL ||
    env.SIFT_BASE_URL ||
    env.SIFT_API_KEY ||
    env.SIFT_TIMEOUT_MS
  ) {
    overrides.provider = {
      provider: env.SIFT_PROVIDER as SiftConfig["provider"]["provider"] | undefined,
      model: env.SIFT_MODEL,
      baseUrl: env.SIFT_BASE_URL,
      apiKey: env.SIFT_API_KEY,
      timeoutMs: env.SIFT_TIMEOUT_MS ? Number(env.SIFT_TIMEOUT_MS) : undefined
    };
  }

  if (env.SIFT_MAX_INPUT_CHARS) {
    overrides.input = {
      ...overrides.input,
      maxCaptureChars: env.SIFT_MAX_CAPTURE_CHARS
        ? Number(env.SIFT_MAX_CAPTURE_CHARS)
        : undefined,
      maxInputChars: Number(env.SIFT_MAX_INPUT_CHARS)
    };
  }

  if (env.SIFT_MAX_CAPTURE_CHARS && !overrides.input) {
    overrides.input = {
      maxCaptureChars: Number(env.SIFT_MAX_CAPTURE_CHARS)
    };
  }

  return overrides;
}

export interface ResolveOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cliOverrides?: PartialSiftConfig;
}

export function resolveConfig(options: ResolveOptions = {}): SiftConfig {
  const env = options.env ?? process.env;
  const fileConfig = loadRawConfig(options.configPath);
  const envConfig = buildEnvOverrides(env);
  const merged = mergeDefined(
    mergeDefined(mergeDefined(defaultConfig, fileConfig), envConfig),
    options.cliOverrides ?? {}
  );

  return siftConfigSchema.parse(merged);
}
