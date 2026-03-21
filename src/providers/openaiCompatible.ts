import type { GenerateInput, GenerateResult } from "../types.js";
import type { LLMProvider } from "./base.js";
import { REDUCTION_SYSTEM_INSTRUCTION } from "./systemInstruction.js";

interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey?: string;
  name?: string;
}

function supportsNativeJsonResponseFormat(baseUrl: string, mode: GenerateInput["jsonResponseFormat"]): boolean {
  if (mode === "off") {
    return false;
  }

  if (mode === "on") {
    return true;
  }

  return /^https:\/\/api\.openai\.com(?:\/|$)/i.test(baseUrl);
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

async function buildOpenAICompatibleError(response: Response): Promise<Error> {
  let detail = `Provider returned HTTP ${response.status}`;

  try {
    const data = (await response.json()) as any;
    const message = data?.error?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      detail = `${detail}: ${message.trim()}`;
    }
  } catch {
    // Keep the generic HTTP status message when the error body is unavailable.
  }

  return new Error(detail);
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.name = options.name ?? "openai-compatible";
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
          connection: "close",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: input.model,
          temperature: input.temperature,
          max_tokens: input.maxOutputTokens,
          ...(input.responseMode === "json" &&
          supportsNativeJsonResponseFormat(this.baseUrl, input.jsonResponseFormat)
            ? { response_format: { type: "json_object" } }
            : {}),
          messages: [
            {
              role: "system",
              content: REDUCTION_SYSTEM_INSTRUCTION
            },
            {
              role: "user",
              content: input.prompt
            }
          ]
        })
      });

      if (!response.ok) {
        throw await buildOpenAICompatibleError(response);
      }

      const data = (await response.json()) as any;
      const text = extractMessageText(data);

      if (!text.trim()) {
        throw new Error("Provider returned an empty response");
      }

      const result = {
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
      clearTimeout(timeout);
      return result;
    } catch (error) {
      clearTimeout(timeout);

      if ((error as NodeJS.ErrnoException).name === "AbortError") {
        throw new Error("Provider request timed out");
      }

      throw error;
    }
  }
}
