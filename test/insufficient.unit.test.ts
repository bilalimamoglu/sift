import { describe, expect, it } from "vitest";
import {
  buildInsufficientSignalOutput,
  classifyEvidenceShape,
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
        recognizedRunner: "pytest",
        inputText: "============================= test session starts =============================\nFAILED tests/test_app.py::test_it_works"
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
        recognizedRunner: "pytest",
        inputText: "============================= test session starts =============================\nFAILED tests/test_app.py::test_it_works"
      })
    ).not.toContain("try --preset test-status");
  });

  it("classifies common repo evidence shapes", () => {
    expect(
      classifyEvidenceShape("# README\n\n- Install with npm\n- Run sift exec first\n")
    ).toBe("prose-doc");
    expect(
      classifyEvidenceShape("src/commands/install.ts:42:  io.write('hello')\ndocs/cli-reference.md:15: run sift exec first")
    ).toBe("grep-hits");
    expect(
      classifyEvidenceShape("src/commands/install.ts\nsrc/core/run.ts\ndocs/cli-reference.md\n")
    ).toBe("path-list");
    expect(
      classifyEvidenceShape("src/core/run.ts | 14 +++++++---\ntest/history.unit.test.ts | 9 +++++-\n2 files changed, 18 insertions(+), 5 deletions(-)\n")
    ).toBe("diff-stat");
    expect(
      classifyEvidenceShape('{\n  "name": "sift",\n  "version": "0.5.0"\n}\n')
    ).toBe("structured-data");
  });

  it("uses repo-evidence-aware hints instead of test hints", () => {
    expect(
      buildInsufficientSignalOutput({
        presetName: "lint-failures",
        originalLength: 120,
        truncatedApplied: false,
        recognizedRunner: "pytest",
        inputText: "# README\n\n- Install with npm\n- Run sift exec first\n"
      })
    ).toContain("captured output looks like prose or markdown");

    expect(
      buildInsufficientSignalOutput({
        presetName: "lint-failures",
        originalLength: 120,
        truncatedApplied: false,
        recognizedRunner: "pytest",
        inputText: "src/commands/install.ts:42:  io.write('hello')\ndocs/cli-reference.md:15: run sift exec first"
      })
    ).toContain("captured output looks like code-search results");

    expect(
      buildInsufficientSignalOutput({
        presetName: "lint-failures",
        originalLength: 120,
        truncatedApplied: false,
        recognizedRunner: "pytest",
        inputText: "src/commands/install.ts\nsrc/core/run.ts\ndocs/cli-reference.md\n"
      })
    ).toContain("captured output looks like a file/path listing");

    expect(
      buildInsufficientSignalOutput({
        presetName: "lint-failures",
        originalLength: 120,
        truncatedApplied: false,
        recognizedRunner: "pytest",
        inputText: '{\n  "name": "sift",\n  "version": "0.5.0"\n}\n'
      })
    ).toContain("captured output looks like structured config or JSON text");
  });

  it("suppresses runner suggestions for non-test repo evidence", () => {
    expect(
      buildInsufficientSignalOutput({
        presetName: "lint-failures",
        originalLength: 120,
        truncatedApplied: false,
        recognizedRunner: "pytest",
        inputText: "# README\n\n- Install with npm\n- Run sift exec first\n"
      })
    ).not.toContain("try --preset test-status");
  });
});
