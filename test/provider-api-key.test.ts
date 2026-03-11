import { describe, expect, it } from "vitest";
import {
  getProviderApiKeyEnvNames,
  resolveProviderApiKey
} from "../src/config/provider-api-key.js";

describe("resolveProviderApiKey", () => {
  it("prefers provider-native env vars over SIFT_PROVIDER_API_KEY for native providers", () => {
    const apiKey = resolveProviderApiKey("openai", undefined, {
      OPENAI_API_KEY: "openai-key",
      SIFT_PROVIDER_API_KEY: "sift-key"
    });

    expect(apiKey).toBe("openai-key");
  });

  it("uses OPENAI_API_KEY for the default OpenAI-compatible base URL", () => {
    const apiKey = resolveProviderApiKey(
      "openai-compatible",
      "https://api.openai.com/v1",
      {
        OPENAI_API_KEY: "openai-key"
      }
    );

    expect(apiKey).toBe("openai-key");
  });

  it("uses provider-native keys for known OpenAI-compatible endpoints", () => {
    expect(
      resolveProviderApiKey(
        "openai-compatible",
        "https://openrouter.ai/api/v1",
        {
          OPENROUTER_API_KEY: "openrouter-key"
        }
      )
    ).toBe("openrouter-key");

    expect(
      resolveProviderApiKey(
        "openai-compatible",
        "https://api.together.xyz/v1",
        {
          TOGETHER_API_KEY: "together-key"
        }
      )
    ).toBe("together-key");

    expect(
      resolveProviderApiKey(
        "openai-compatible",
        "https://api.groq.com/openai/v1",
        {
          GROQ_API_KEY: "groq-key"
        }
      )
    ).toBe("groq-key");
  });

  it("does not use OPENAI_API_KEY for unknown OpenAI-compatible endpoints", () => {
    const apiKey = resolveProviderApiKey(
      "openai-compatible",
      "https://proxy.example.test/v1",
      {
        OPENAI_API_KEY: "openai-key"
      }
    );

    expect(apiKey).toBeUndefined();
  });

  it("uses OPENAI_API_KEY for the openai provider", () => {
    const apiKey = resolveProviderApiKey("openai", undefined, {
      OPENAI_API_KEY: "openai-key"
    });

    expect(apiKey).toBe("openai-key");
  });

  it("uses ANTHROPIC_API_KEY for anthropic-style providers", () => {
    expect(
      resolveProviderApiKey("anthropic", undefined, {
        ANTHROPIC_API_KEY: "anthropic-key"
      })
    ).toBe("anthropic-key");

    expect(
      resolveProviderApiKey("claude", undefined, {
        ANTHROPIC_API_KEY: "anthropic-key"
      })
    ).toBe("anthropic-key");
  });

  it("returns undefined for providers without a registered fallback env var", () => {
    const apiKey = resolveProviderApiKey("custom-provider", undefined, {
      OPENAI_API_KEY: "openai-key"
    });

    expect(apiKey).toBeUndefined();
  });

  it("falls back to SIFT_PROVIDER_API_KEY for unknown or missing providers", () => {
    expect(
      resolveProviderApiKey(undefined, undefined, {
        SIFT_PROVIDER_API_KEY: "generic-key"
      })
    ).toBe("generic-key");

    expect(
      resolveProviderApiKey("custom-provider", undefined, {
        SIFT_PROVIDER_API_KEY: "generic-key"
      })
    ).toBe("generic-key");
  });

  it("reports env names for the active provider/base URL combination", () => {
    expect(
      getProviderApiKeyEnvNames("openai-compatible", "https://api.openai.com/v1")
    ).toEqual(["SIFT_PROVIDER_API_KEY", "OPENAI_API_KEY"]);

    expect(
      getProviderApiKeyEnvNames("openai-compatible", "https://proxy.example.test/v1")
    ).toEqual(["SIFT_PROVIDER_API_KEY"]);

    expect(getProviderApiKeyEnvNames("openai", "https://api.openai.com/v1")).toEqual([
      "OPENAI_API_KEY",
      "SIFT_PROVIDER_API_KEY"
    ]);
    expect(getProviderApiKeyEnvNames(undefined, undefined)).toEqual([
      "SIFT_PROVIDER_API_KEY"
    ]);
    expect(getProviderApiKeyEnvNames("custom-provider", "https://example.test")).toEqual([
      "SIFT_PROVIDER_API_KEY"
    ]);
  });
});
