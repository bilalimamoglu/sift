import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { getPreset } from "../src/prompts/presets.js";

describe("getPreset", () => {
  it("returns a known preset", () => {
    expect(getPreset(defaultConfig, "test-status").question).toContain("tests");
  });

  it("returns the built-in typecheck and lint presets", () => {
    expect(getPreset(defaultConfig, "typecheck-summary")).toMatchObject({
      format: "bullets",
      policy: "typecheck-summary"
    });
    expect(getPreset(defaultConfig, "lint-failures")).toMatchObject({
      format: "bullets",
      policy: "lint-failures"
    });
  });

  it("throws for an unknown preset", () => {
    expect(() => getPreset(defaultConfig, "missing")).toThrow("Unknown preset");
  });
});
