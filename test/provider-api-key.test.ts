import { describe, expect, it } from "vitest";
import { resolveProviderApiKey } from "../src/config/provider-api-key.js";

describe("resolveProviderApiKey", () => {
  it("prefers SIFT_PROVIDER_API_KEY over provider-specific fallback env vars", () => {
    const apiKey = resolveProviderApiKey("openai", {
      OPENAI_API_KEY: "openai-key",
      SIFT_PROVIDER_API_KEY: "sift-key"
    });

    expect(apiKey).toBe("sift-key");
  });

  it("does not read the legacy SIFT_API_KEY env var", () => {
    const apiKey = resolveProviderApiKey("openai-compatible", {
      SIFT_API_KEY: "legacy-key"
    });

    expect(apiKey).toBeUndefined();
  });

  it("does not use OPENAI_API_KEY for openai-compatible", () => {
    const apiKey = resolveProviderApiKey("openai-compatible", {
      OPENAI_API_KEY: "openai-key"
    });

    expect(apiKey).toBeUndefined();
  });

  it("uses OPENAI_API_KEY for the openai provider", () => {
    const apiKey = resolveProviderApiKey("openai", {
      OPENAI_API_KEY: "openai-key"
    });

    expect(apiKey).toBe("openai-key");
  });

  it("uses ANTHROPIC_API_KEY for anthropic-style providers", () => {
    expect(
      resolveProviderApiKey("anthropic", {
        ANTHROPIC_API_KEY: "anthropic-key"
      })
    ).toBe("anthropic-key");

    expect(
      resolveProviderApiKey("claude", {
        ANTHROPIC_API_KEY: "anthropic-key"
      })
    ).toBe("anthropic-key");
  });

  it("returns undefined for providers without a registered fallback env var", () => {
    const apiKey = resolveProviderApiKey("custom-provider", {
      OPENAI_API_KEY: "openai-key"
    });

    expect(apiKey).toBeUndefined();
  });
});
