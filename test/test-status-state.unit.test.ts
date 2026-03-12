import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTestStatus } from "../src/core/heuristics.js";
import {
  InvalidCachedTestStatusRunError,
  MissingCachedTestStatusRunError,
  buildTestStatusCommandKey,
  createCachedTestStatusRun,
  diffTestStatusRuns,
  getNextEscalationDetail,
  getRemainingPytestNodeIds,
  readCachedTestStatusRun,
  renderTestStatusDelta,
  tryReadCachedTestStatusRun,
  writeCachedTestStatusRun
} from "../src/core/testStatusState.js";

function readRealFixture(name: string): string {
  return fs.readFileSync(
    path.resolve(import.meta.dirname, "fixtures", "bench", "test-status", "real", name),
    "utf8"
  );
}

describe("test-status state helpers", () => {
  it("writes and reads cached test-status runs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-state-"));
    const statePath = path.join(dir, "last-test-status.json");
    const rawOutput = [
      "=================== short test summary info ===================",
      "ERROR tests/db/test_users.py - RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN",
      "ERROR tests/db/test_posts.py - RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN",
      "2 errors in 0.12s"
    ].join("\n");
    const state = createCachedTestStatusRun({
      cwd: "/tmp/repo",
      commandKey: buildTestStatusCommandKey({
        commandPreview: "pytest",
        shellCommand: undefined
      }),
      commandPreview: "pytest",
      command: ["pytest"],
      detail: "standard",
      exitCode: 1,
      rawOutput,
      originalChars: rawOutput.length,
      truncatedApplied: false,
      analysis: analyzeTestStatus(rawOutput),
      timestamp: "2026-03-12T14:30:00.000Z"
    });

    writeCachedTestStatusRun(state, statePath);

    expect(readCachedTestStatusRun(statePath)).toEqual(state);
    expect(tryReadCachedTestStatusRun(statePath)).toEqual(state);
    expect(state.command).toEqual({
      mode: "argv",
      argv: ["pytest"]
    });
    expect(state.pytest?.subsetCapable).toBe(true);
    expect(state.pytest?.failingNodeIds).toEqual([
      "tests/db/test_users.py",
      "tests/db/test_posts.py"
    ]);
  });

  it("reports missing and invalid cache files clearly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-state-"));
    const missingPath = path.join(dir, "missing.json");
    const invalidPath = path.join(dir, "invalid.json");

    expect(() => readCachedTestStatusRun(missingPath)).toThrow(MissingCachedTestStatusRunError);
    expect(tryReadCachedTestStatusRun(missingPath)).toBeNull();

    fs.writeFileSync(invalidPath, '{"version":1,"presetName":"test-status"}\n', "utf8");
    expect(() => readCachedTestStatusRun(invalidPath)).toThrow(InvalidCachedTestStatusRunError);
    expect(tryReadCachedTestStatusRun(invalidPath)).toBeNull();
  });

  it("builds deterministic delta lines and escalation levels", () => {
    const previousRaw = readRealFixture("snapshot-drift-only.txt");
    const currentRaw = readRealFixture("single-blocker-short.txt");
    const previous = createCachedTestStatusRun({
      cwd: "/tmp/repo",
      commandKey: "argv:pytest",
      commandPreview: "pytest",
      command: ["pytest"],
      detail: "standard",
      exitCode: 1,
      rawOutput: previousRaw,
      originalChars: previousRaw.length,
      truncatedApplied: false,
      analysis: analyzeTestStatus(previousRaw)
    });
    const current = createCachedTestStatusRun({
      cwd: "/tmp/repo",
      commandKey: "argv:pytest",
      commandPreview: "pytest",
      command: ["pytest"],
      detail: "standard",
      exitCode: 1,
      rawOutput: currentRaw,
      originalChars: currentRaw.length,
      truncatedApplied: false,
      analysis: analyzeTestStatus(currentRaw)
    });

    const delta = renderTestStatusDelta({
      previous,
      current
    });
    const diff = diffTestStatusRuns({
      previous,
      current
    });

    expect(delta).toHaveLength(2);
    expect(delta[0]).toContain("- Resolved:");
    expect(delta[1]).toContain("- New:");
    expect(diff.remainingNodeIds).toEqual([]);
    expect(getRemainingPytestNodeIds(current)).toEqual(current.pytest?.failingNodeIds ?? []);
    expect(getNextEscalationDetail("standard")).toBe("focused");
    expect(getNextEscalationDetail("focused")).toBe("verbose");
    expect(getNextEscalationDetail("verbose")).toBeNull();
  });
});
