import type { GenerateInput, GenerateResult } from "../types.js";
import type { LLMProvider } from "./base.js";

interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey?: string;
}

function extractMessageText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .join("")
      .trim();
  }

  return "";
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const url = new URL("chat/completions", `${this.baseUrl}/`);
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: input.model,
          temperature: input.temperature,
          max_tokens: input.maxOutputTokens,
          messages: [
            {
              role: "system",
              content:
                "You reduce noisy command output into compact answers for agents and automation."
            },
            {
              role: "user",
              content: input.prompt
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Provider returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as any;
      const text = extractMessageText(data);

      if (!text.trim()) {
        throw new Error("Provider returned an empty response");
      }

      return {
        text,
        usage: data?.usage
          ? {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens
            }
          : undefined,
        raw: data
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).name === "AbortError") {
        throw new Error("Provider request timed out");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
