import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import {
  looksLikeWatchStream,
  runWatch,
  splitWatchCycles
} from "../src/core/watch.js";

const { runSiftMock } = vi.hoisted(() => ({
  runSiftMock: vi.fn()
}));

vi.mock("../src/core/run.js", () => ({
  runSift: runSiftMock
}));

describe("watch helpers", () => {
  it("detects redraw-style cycles and ignores ordinary single-run output", () => {
    const watchInput = [
      "\u001bc",
      "watching for file changes",
      "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
      "1 failed in 0.10s",
      "\u001bc",
      "watching for file changes",
      "12 passed in 0.10s"
    ].join("\n");

    expect(splitWatchCycles(watchInput)).toHaveLength(2);
    expect(looksLikeWatchStream(watchInput)).toBe(true);
    expect(
      looksLikeWatchStream(
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token\n1 failed in 0.10s"
      )
    ).toBe(false);
  });

  it("renders test-status watch cycles with diff lines", async () => {
    runSiftMock.mockReset();
    runSiftMock.mockResolvedValueOnce("cycle one summary").mockResolvedValueOnce("cycle two summary");

    const output = await runWatch({
      question: "Did the tests pass?",
      format: "bullets",
      goal: "summarize",
      stdin: [
        "\u001bc",
        "watching for file changes",
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "2 failed in 0.10s",
        "\u001bc",
        "watching for file changes",
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "1 failed in 0.10s"
      ].join("\n"),
      config: defaultConfig,
      policyName: "test-status",
      presetName: "test-status"
    });

    expect(output).toContain("- Cycle 1");
    expect(output).toContain("cycle one summary");
    expect(output).toContain("- Cycle 2");
    expect(output).toContain("- Resolved:");
    expect(output).toContain("- Remaining:");
    expect(output).toContain("cycle two summary");
  });

  it("returns a combined JSON payload for test-status diagnose watch flows", async () => {
    runSiftMock.mockReset();
    runSiftMock
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "ok",
          diagnosis_complete: true,
          next_best_action: {
            code: "fix_dominant_blocker"
          }
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "insufficient",
          diagnosis_complete: false,
          next_best_action: {
            code: "read_raw_for_exact_traceback"
          }
        })
      );

    const output = await runWatch({
      question: "Diagnose the failures.",
      format: "json",
      goal: "diagnose",
      stdin: [
        "\u001bc",
        "watching for file changes",
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "1 failed in 0.10s",
        "\u001bc",
        "watching for file changes",
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "1 failed in 0.10s"
      ].join("\n"),
      config: defaultConfig,
      policyName: "test-status",
      presetName: "test-status"
    });

    const parsed = JSON.parse(output) as {
      status: string;
      cycles: Array<{ cycle: number; changes: string[] }>;
      next_best_action: { code: string };
    };

    expect(parsed.status).toBe("insufficient");
    expect(parsed.cycles).toHaveLength(2);
    expect(parsed.cycles[1]?.changes.some((line) => line.includes("New:"))).toBe(true);
    expect(parsed.next_best_action.code).toBe("read_raw_for_exact_traceback");
  });

  it("uses provider-backed generic change summaries across cycles", async () => {
    runSiftMock.mockReset();
    runSiftMock
      .mockResolvedValueOnce("first summary")
      .mockResolvedValueOnce("second summary")
      .mockResolvedValueOnce("- changed: only one warning remains");

    const output = await runWatch({
      question: "What changed between cycles?",
      format: "brief",
      goal: "summarize",
      stdin: [
        "\u001bc",
        "watching for file changes",
        "warning: first issue",
        "\u001bc",
        "watching for file changes",
        "warning: one issue left"
      ].join("\n"),
      config: defaultConfig
    });

    expect(output).toContain("- Cycle 1");
    expect(output).toContain("first summary");
    expect(output).toContain("- Cycle 2");
    expect(output).toContain("changed: only one warning remains");
    expect(output).toContain("second summary");
  });
});
