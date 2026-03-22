import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { siftConfigSchema } from "../src/config/schema.js";

describe("siftConfigSchema", () => {
  it("accepts the default config", () => {
    expect(siftConfigSchema.parse(defaultConfig)).toEqual(defaultConfig);
  });

  it("accepts lightweight safety override lists", () => {
    const parsed = siftConfigSchema.parse({
      ...defaultConfig,
      safety: {
        enabled: true,
        extraRiskPatterns: ["internal build note"],
        ignoredRiskPatterns: ["ignore previous instructions"]
      }
    });

    expect(parsed.safety.extraRiskPatterns).toContain("internal build note");
    expect(parsed.safety.ignoredRiskPatterns).toContain("ignore previous instructions");
  });

  it("accepts tiny local history settings", () => {
    const parsed = siftConfigSchema.parse({
      ...defaultConfig,
      history: {
        enabled: true,
        retentionDays: 14
      }
    });

    expect(parsed.history.enabled).toBe(true);
    expect(parsed.history.retentionDays).toBe(14);
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

  it("accepts all supported runtime operation modes", () => {
    expect(
      siftConfigSchema.parse({
        ...defaultConfig,
        runtime: {
          ...defaultConfig.runtime,
          operationMode: "provider-assisted"
        }
      }).runtime.operationMode
    ).toBe("provider-assisted");

    expect(
      siftConfigSchema.parse({
        ...defaultConfig,
        runtime: {
          ...defaultConfig.runtime,
          operationMode: "local-only"
        }
      }).runtime.operationMode
    ).toBe("local-only");
  });

  it("rejects unsupported runtime operation modes", () => {
    expect(() =>
      siftConfigSchema.parse({
        ...defaultConfig,
        runtime: {
          ...defaultConfig.runtime,
          operationMode: "something-else"
        }
      })
    ).toThrow();
  });
});
