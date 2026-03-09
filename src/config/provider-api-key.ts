const OPENAI_COMPATIBLE_BASE_URL_ENV: Array<{
  prefix: string;
  envName: string;
}> = [
  { prefix: "https://api.openai.com/", envName: "OPENAI_API_KEY" },
  { prefix: "https://openrouter.ai/api/", envName: "OPENROUTER_API_KEY" },
  { prefix: "https://api.together.xyz/", envName: "TOGETHER_API_KEY" },
  { prefix: "https://api.groq.com/openai/", envName: "GROQ_API_KEY" }
];

const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  together: "TOGETHER_API_KEY"
};

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  return `${baseUrl.replace(/\/+$/, "")}/`.toLowerCase();
}

function resolveCompatibleEnvName(baseUrl: string | undefined): string | undefined {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return undefined;
  }

  const match = OPENAI_COMPATIBLE_BASE_URL_ENV.find((entry) =>
    normalized.startsWith(entry.prefix)
  );

  return match?.envName;
}

export function resolveProviderApiKey(
  provider: string | undefined,
  baseUrl: string | undefined,
  env: NodeJS.ProcessEnv
): string | undefined {
  if (env.SIFT_PROVIDER_API_KEY) {
    return env.SIFT_PROVIDER_API_KEY;
  }

  if (provider === "openai-compatible") {
    const envName = resolveCompatibleEnvName(baseUrl);
    return envName ? env[envName] : undefined;
  }

  if (!provider) {
    return undefined;
  }

  const envName = PROVIDER_API_KEY_ENV[provider];
  return envName ? env[envName] : undefined;
}

export function getProviderApiKeyEnvNames(
  provider: string | undefined,
  baseUrl: string | undefined
): string[] {
  const envNames = ["SIFT_PROVIDER_API_KEY"];

  if (provider === "openai-compatible") {
    const envName = resolveCompatibleEnvName(baseUrl);
    if (envName) {
      envNames.push(envName);
    }
    return envNames;
  }

  if (!provider) {
    return envNames;
  }

  const envName = PROVIDER_API_KEY_ENV[provider];
  if (envName) {
    envNames.push(envName);
  }

  return envNames;
}
