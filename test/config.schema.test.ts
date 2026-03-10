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

  it("accepts preset contracts and fallback JSON", () => {
    const parsed = siftConfigSchema.parse({
      ...defaultConfig,
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
  });
});
