import { describe, expect, it } from "vitest";
import {
  buildInsufficientSignalOutput,
  isInsufficientSignalOutput
} from "../src/core/insufficient.js";

describe("insufficient signal helpers", () => {
  it("recognizes bare and hinted insufficient outputs", () => {
    expect(
      isInsufficientSignalOutput("Insufficient signal in the provided input.")
    ).toBe(true);
    expect(
      isInsufficientSignalOutput(
        "Insufficient signal in the provided input.\nHint: no command output was captured."
      )
    ).toBe(true);
    expect(isInsufficientSignalOutput("Something else")).toBe(false);
  });

  it("builds the empty-output hint first", () => {
    expect(
      buildInsufficientSignalOutput({
        originalLength: 0,
        truncatedApplied: false
      })
    ).toContain("Hint: no command output was captured.");
  });

  it("builds the truncation hint before preset-specific hints", () => {
    expect(
      buildInsufficientSignalOutput({
        presetName: "test-status",
        originalLength: 100,
        truncatedApplied: true,
        exitCode: 0
      })
    ).toContain(
      "Hint: captured output was truncated before a clear summary was found."
    );
  });

  it("builds test-status hints for successful and failing exits", () => {
    expect(
      buildInsufficientSignalOutput({
        presetName: "test-status",
        originalLength: 100,
        truncatedApplied: false,
        exitCode: 0
      })
    ).toContain(
      "Hint: command succeeded, but no recognizable test summary was found."
    );

    expect(
      buildInsufficientSignalOutput({
        presetName: "test-status",
        originalLength: 100,
        truncatedApplied: false,
        exitCode: 2
      })
    ).toContain(
      "Hint: command failed, but the captured output did not include a recognizable test summary."
    );
  });

  it("falls back to a generic preset hint", () => {
    expect(
      buildInsufficientSignalOutput({
        presetName: "lint-failures",
        originalLength: 20,
        truncatedApplied: false
      })
    ).toContain(
      "Hint: the captured output did not contain a clear answer for this preset."
    );
  });

  it("adds a runner-aware preset suggestion for non-test-status insufficient output", () => {
    expect(
      buildInsufficientSignalOutput({
        presetName: "lint-failures",
        originalLength: 20,
        truncatedApplied: false,
        recognizedRunner: "pytest"
      })
    ).toContain(
      "Hint: captured output looks like pytest test output; try --preset test-status."
    );
  });

  it("does not add a runner-aware preset suggestion for test-status", () => {
    expect(
      buildInsufficientSignalOutput({
        presetName: "test-status",
        originalLength: 100,
        truncatedApplied: false,
        exitCode: 0,
        recognizedRunner: "pytest"
      })
    ).not.toContain("try --preset test-status");
  });
});
