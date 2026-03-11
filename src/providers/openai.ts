import type { GenerateInput, GenerateResult } from "../types.js";
import type { LLMProvider } from "./base.js";
import { REDUCTION_SYSTEM_INSTRUCTION } from "./systemInstruction.js";

interface OpenAIProviderOptions {
  baseUrl: string;
  apiKey?: string;
}

function usesNativeJsonResponseFormat(mode: GenerateInput["jsonResponseFormat"]): boolean {
  return mode !== "off";
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string") {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload?.output)) {
    return "";
  }

  return payload.output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((item: any) => (item?.type === "output_text" ? item.text : ""))
    .filter((text: unknown) => typeof text === "string" && text.trim().length > 0)
    .join("")
    .trim();
}

async function buildOpenAIError(response: Response): Promise<Error> {
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

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: OpenAIProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const url = new URL("responses", `${this.baseUrl}/`);
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: input.model,
          instructions: REDUCTION_SYSTEM_INSTRUCTION,
          input: input.prompt,
          reasoning: {
            effort: "minimal"
          },
          text: {
            verbosity: "low",
            ...(input.responseMode === "json" &&
            usesNativeJsonResponseFormat(input.jsonResponseFormat)
              ? {
                  format: {
                    type: "json_object"
                  }
                }
              : {})
          },
          max_output_tokens: input.maxOutputTokens,
        })
      });

      if (!response.ok) {
        throw await buildOpenAIError(response);
      }

      const data = (await response.json()) as any;
      const text = extractResponseText(data);

      if (!text) {
        throw new Error("Provider returned an empty response");
      }

      const result = {
        text,
        usage: data?.usage
          ? {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
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
