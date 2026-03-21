import { describe, expect, it } from "vitest";
import { truncateInput } from "../src/core/truncate.js";

describe("truncateInput", () => {
  it("does not change small input", () => {
    const result = truncateInput("hello", {
      maxInputChars: 100,
      headChars: 10,
      tailChars: 10
    });

    expect(result.truncatedApplied).toBe(false);
    expect(result.text).toBe("hello");
  });

  it("preserves signal lines when truncating", () => {
    const input = [
      "a".repeat(1200),
      "ERROR failed to connect to database",
      "b".repeat(1200),
      "Traceback: boom"
    ].join("\n");

    const result = truncateInput(input, {
      maxInputChars: 700,
      headChars: 250,
      tailChars: 250
    });

    expect(result.truncatedApplied).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(700);
    expect(result.text).toContain("failed to connect");
  });
});
