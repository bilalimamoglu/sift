import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { getPreset } from "../src/prompts/presets.js";

describe("getPreset", () => {
  it("returns a known preset", () => {
    expect(getPreset(defaultConfig, "test-status").question).toContain("tests");
  });

  it("throws for an unknown preset", () => {
    expect(() => getPreset(defaultConfig, "missing")).toThrow("Unknown preset");
  });
});
