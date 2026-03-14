import type { SiftConfig } from "../types.js";
import type { LLMProvider } from "./base.js";
import { OpenAIProvider } from "./openai.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createProvider(config: SiftConfig): LLMProvider {
  if (config.provider.provider === "openai") {
    return new OpenAIProvider({
      baseUrl: config.provider.baseUrl,
      apiKey: config.provider.apiKey
    });
  }

  if (config.provider.provider === "openai-compatible") {
    return new OpenAICompatibleProvider({
      baseUrl: config.provider.baseUrl,
      apiKey: config.provider.apiKey
    });
  }

  if (config.provider.provider === "openrouter") {
    return new OpenAICompatibleProvider({
      baseUrl: config.provider.baseUrl,
      apiKey: config.provider.apiKey,
      name: "openrouter"
    });
  }

  throw new Error(`Unsupported provider: ${config.provider.provider}`);
}
