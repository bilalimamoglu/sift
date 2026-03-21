import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { siftConfigSchema } from "../src/config/schema.js";

describe("siftConfigSchema", () => {
  it("accepts the default config", () => {
    expect(siftConfigSchema.parse(defaultConfig)).toEqual(defaultConfig);
  });

  it("accepts the native openai provider", () => {
    const parsed = siftConfigSchema.parse({
      ...defaultConfig,
      provider: {
        ...defaultConfig.provider,
        provider: "openai"
      }
    });

    expect(parsed.provider.provider).toBe("openai");
  });

  it("accepts the native openrouter provider", () => {
    const parsed = siftConfigSchema.parse({
      ...defaultConfig,
      provider: {
        ...defaultConfig.provider,
        provider: "openrouter",
        model: "openrouter/free",
        baseUrl: "https://openrouter.ai/api/v1"
      }
    });

    expect(parsed.provider.provider).toBe("openrouter");
  });

  it("accepts preset contracts and fallback JSON", () => {
    const parsed = siftConfigSchema.parse({
      ...defaultConfig,
      providerProfiles: {
        openrouter: {
          model: "openrouter/free",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "or-key"
        }
      },
      presets: {
        custom: {
          question: "Extract issues",
          format: "json",
          policy: "audit-critical",
          outputContract: '{"issues":[string]}',
          fallbackJson: {
            issues: []
          }
        }
      }
    });

    expect(parsed.presets.custom?.policy).toBe("audit-critical");
    expect(parsed.presets.custom?.outputContract).toContain("issues");
    expect(parsed.providerProfiles?.openrouter?.apiKey).toBe("or-key");
  });
});
