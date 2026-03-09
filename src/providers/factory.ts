import type { SiftConfig } from "../types.js";
import type { LLMProvider } from "./base.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createProvider(config: SiftConfig): LLMProvider {
  if (config.provider.provider === "openai-compatible") {
    return new OpenAICompatibleProvider({
      baseUrl: config.provider.baseUrl,
      apiKey: config.provider.apiKey
    });
  }

  throw new Error(`Unsupported provider: ${config.provider.provider}`);
}
