import { defaultConfig } from "./defaults.js";
import { loadRawConfig } from "./load.js";
import { resolveProviderApiKey } from "./provider-api-key.js";
import { siftConfigSchema } from "./schema.js";
import type { PartialSiftConfig, SiftConfig } from "../types.js";

const PROVIDER_DEFAULT_OVERRIDES: Partial<
  Record<SiftConfig["provider"]["provider"], PartialSiftConfig>
> = {
  openrouter: {
    provider: {
      model: "openrouter/free",
      baseUrl: "https://openrouter.ai/api/v1"
    }
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeDefined<T>(base: T, override: unknown): T {
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

function stripApiKey(
  overrides: PartialSiftConfig | undefined
): PartialSiftConfig | undefined {
  if (!overrides?.provider || overrides.provider.apiKey === undefined) {
    return overrides;
  }

  return {
    ...overrides,
    provider: {
      ...overrides.provider,
      apiKey: undefined
    }
  };
}

function buildNonCredentialEnvOverrides(env: NodeJS.ProcessEnv): PartialSiftConfig {
  const overrides: PartialSiftConfig = {};

  if (
    env.SIFT_PROVIDER ||
    env.SIFT_MODEL ||
    env.SIFT_BASE_URL ||
    env.SIFT_TIMEOUT_MS
  ) {
    overrides.provider = {
      provider: env.SIFT_PROVIDER as SiftConfig["provider"]["provider"] | undefined,
      model: env.SIFT_MODEL,
      baseUrl: env.SIFT_BASE_URL,
      timeoutMs: env.SIFT_TIMEOUT_MS ? Number(env.SIFT_TIMEOUT_MS) : undefined
    };
  }

  if (env.SIFT_MAX_INPUT_CHARS || env.SIFT_MAX_CAPTURE_CHARS) {
    overrides.input = {
      maxCaptureChars: env.SIFT_MAX_CAPTURE_CHARS
        ? Number(env.SIFT_MAX_CAPTURE_CHARS)
        : undefined,
      maxInputChars: env.SIFT_MAX_INPUT_CHARS
        ? Number(env.SIFT_MAX_INPUT_CHARS)
        : undefined
    };
  }

  return overrides;
}

function buildCredentialEnvOverrides(
  env: NodeJS.ProcessEnv,
  context: Pick<SiftConfig["provider"], "provider" | "baseUrl">
): PartialSiftConfig {
  const apiKey = resolveProviderApiKey(context.provider, context.baseUrl, env);
  if (apiKey === undefined) {
    return {};
  }

  return {
    provider: {
      apiKey
    }
  };
}

export interface ResolveOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cliOverrides?: PartialSiftConfig;
}

function getBaseConfigForProvider(
  provider: SiftConfig["provider"]["provider"] | undefined
): SiftConfig {
  return mergeDefined(defaultConfig, provider ? PROVIDER_DEFAULT_OVERRIDES[provider] : {});
}

function resolveProvisionalProvider(args: {
  fileConfig: unknown;
  nonCredentialEnvConfig: PartialSiftConfig;
  cliOverrides: PartialSiftConfig | undefined;
}): SiftConfig["provider"]["provider"] {
  const provisional = mergeDefined(
    mergeDefined(
      mergeDefined(defaultConfig, args.fileConfig),
      args.nonCredentialEnvConfig
    ),
    stripApiKey(args.cliOverrides) ?? {}
  );

  return provisional.provider.provider;
}

export function resolveConfig(options: ResolveOptions = {}): SiftConfig {
  const env = options.env ?? process.env;
  const fileConfig = loadRawConfig(options.configPath);
  const nonCredentialEnvConfig = buildNonCredentialEnvOverrides(env);
  const provisionalProvider = resolveProvisionalProvider({
    fileConfig,
    nonCredentialEnvConfig,
    cliOverrides: options.cliOverrides
  });
  const baseConfig = getBaseConfigForProvider(provisionalProvider);
  const contextConfig = mergeDefined(
    mergeDefined(
      mergeDefined(baseConfig, fileConfig),
      nonCredentialEnvConfig
    ),
    stripApiKey(options.cliOverrides) ?? {}
  );
  const credentialEnvConfig = buildCredentialEnvOverrides(env, {
    provider: contextConfig.provider.provider,
    baseUrl: contextConfig.provider.baseUrl
  });
  const merged = mergeDefined(
    mergeDefined(
      mergeDefined(
        mergeDefined(baseConfig, fileConfig),
        nonCredentialEnvConfig
      ),
      credentialEnvConfig
    ),
    options.cliOverrides ?? {}
  );

  return siftConfigSchema.parse(merged);
}
