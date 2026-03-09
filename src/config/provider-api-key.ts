// Only first-class provider names should read provider-specific fallback env vars.
// "openai-compatible" intentionally does not consume OPENAI_API_KEY because the
// target backend may be OpenAI, OpenRouter, Together, Groq, or a self-hosted proxy.
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  together: "TOGETHER_API_KEY"
};

export function resolveProviderApiKey(
  provider: string | undefined,
  env: NodeJS.ProcessEnv
): string | undefined {
  if (env.SIFT_PROVIDER_API_KEY) {
    return env.SIFT_PROVIDER_API_KEY;
  }

  if (!provider) {
    return undefined;
  }

  const envName = PROVIDER_API_KEY_ENV[provider];
  return envName ? env[envName] : undefined;
}
