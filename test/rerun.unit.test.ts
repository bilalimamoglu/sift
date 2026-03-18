import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultTestStatusStatePath } from "../src/constants.js";
import { defaultConfig } from "../src/config/defaults.js";
import { analyzeTestStatus } from "../src/core/heuristics.js";
import {
  createCachedTestStatusRun,
  writeCachedTestStatusRun
} from "../src/core/testStatusState.js";

const { runExecMock } = vi.hoisted(() => ({
  runExecMock: vi.fn()
}));

vi.mock("../src/core/exec.js", () => ({
  runExec: runExecMock
}));

function writeState(args: {
  homeDir: string;
  cwd?: string;
  command?: string[];
  shellCommand?: string;
  rawOutput: string;
}) {
  writeCachedTestStatusRun(
    createCachedTestStatusRun({
      cwd: args.cwd ?? "/tmp/repo",
      commandKey: args.shellCommand ? `shell:${args.shellCommand}` : `argv:${(args.command ?? []).join(" ")}`,
      commandPreview: args.shellCommand ?? (args.command ?? []).join(" "),
      command: args.command,
      shellCommand: args.shellCommand,
      detail: "standard",
      exitCode: /failed|error/i.test(args.rawOutput) ? 1 : 0,
      rawOutput: args.rawOutput,
      originalChars: args.rawOutput.length,
      truncatedApplied: false,
      analysis: analyzeTestStatus(args.rawOutput)
    }),
    getDefaultTestStatusStatePath(args.homeDir)
  );
}

describe("runRerun", () => {
  let homeDir = "";

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-rerun-home-"));
    runExecMock.mockReset();
    vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reruns the cached full command in standard diff mode", async () => {
    writeState({
      homeDir,
      command: ["pytest", "-q"],
      rawOutput: [
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "1 failed in 0.12s"
      ].join("\n")
    });
    runExecMock.mockResolvedValue(1);

    const { runRerun } = await import("../src/core/rerun.js");
    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: defaultConfig
      })
    ).resolves.toBe(1);

    expect(runExecMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["pytest", "-q"],
        cwd: "/tmp/repo",
        diff: true,
        detail: "standard",
        presetName: "test-status",
        showRaw: false
      })
    );
  });

  it("reruns only the cached remaining pytest subset without rewriting cache", async () => {
    writeState({
      homeDir,
      command: ["python", "-m", "pytest", "-q"],
      rawOutput: [
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "2 failed in 0.12s"
      ].join("\n")
    });
    runExecMock.mockResolvedValue(1);

    const { runRerun } = await import("../src/core/rerun.js");
    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: defaultConfig,
        remaining: true,
        detail: "focused",
        showRaw: true
      })
    ).resolves.toBe(1);

    expect(runExecMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: [
          "python",
          "-m",
          "pytest",
          "-q",
          "tests/unit/test_auth.py::test_refresh",
          "tests/unit/test_users.py::test_list"
        ],
        cwd: "/tmp/repo",
        detail: "focused",
        diff: false,
        presetName: "test-status",
        showRaw: true,
        readCachedBaseline: true,
        writeCachedBaseline: false,
        testStatusContext: expect.objectContaining({
          remainingSubsetAvailable: true,
          remainingMode: "subset_rerun"
        })
      })
    );
  });

  it("falls back to the current failing pytest targets when no diff-derived remaining subset exists", async () => {
    writeState({
      homeDir,
      command: ["pytest", "-q"],
      rawOutput: [
        "ERROR tests/unit/test_auth.py::test_refresh - RuntimeError: worker crashed",
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "1 failed, 1 error in 0.12s"
      ].join("\n")
    });
    runExecMock.mockResolvedValue(1);

    const { runRerun } = await import("../src/core/rerun.js");
    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: defaultConfig,
        remaining: true
      })
    ).resolves.toBe(1);

    expect(runExecMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: [
          "pytest",
          "-q",
          "tests/unit/test_auth.py::test_refresh",
          "tests/unit/test_users.py::test_list"
        ]
      })
    );
  });

  it("exits cleanly when there are no remaining failing pytest targets", async () => {
    writeState({
      homeDir,
      command: ["pytest", "-q"],
      rawOutput: "12 passed in 0.12s"
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { runRerun } = await import("../src/core/rerun.js");
    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: defaultConfig,
        remaining: true
      })
    ).resolves.toBe(0);

    expect(runExecMock).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith("No remaining failing pytest targets.\n");
  });

  it("reruns the cached full vitest command in remaining diff mode without overwriting baseline", async () => {
    writeState({
      homeDir,
      command: ["vitest", "run"],
      rawOutput: [
        " FAIL  tests/unit/auth.test.ts > refresh token",
        "AssertionError: expected token",
        "",
        "Tests  1 failed"
      ].join("\n")
    });
    runExecMock.mockResolvedValue(1);

    const { runRerun } = await import("../src/core/rerun.js");
    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: defaultConfig,
        remaining: true
      })
    ).resolves.toBe(1);

    expect(runExecMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["vitest", "run"],
        cwd: "/tmp/repo",
        diff: false,
        presetName: "test-status",
        readCachedBaseline: true,
        writeCachedBaseline: false,
        testStatusContext: expect.objectContaining({
          remainingSubsetAvailable: false,
          remainingMode: "full_rerun_diff"
        })
      })
    );
  });

  it("fails clearly when a migrated cache lacks a trustworthy full-command baseline", async () => {
    const legacyStatePath = getDefaultTestStatusStatePath(homeDir);
    fs.mkdirSync(path.dirname(legacyStatePath), {
      recursive: true
    });
    fs.writeFileSync(
      legacyStatePath,
      `${JSON.stringify(
        {
          version: 1,
          timestamp: "2026-03-18T10:00:00.000Z",
          presetName: "test-status",
          cwd: "/tmp/repo",
          commandKey: "argv:vitest run",
          commandPreview: "vitest run",
          detail: "standard",
          exitCode: 1,
          rawOutput: [
            " FAIL  tests/unit/auth.test.ts > refresh token",
            "AssertionError: expected token",
            "",
            "Test Files  1 failed | 0 passed",
            "Tests  1 failed | 0 passed"
          ].join("\n"),
          capture: {
            originalChars: 72,
            truncatedApplied: false
          },
          analysis: createCachedTestStatusRun({
            cwd: "/tmp/repo",
            command: ["vitest", "run"],
            detail: "standard",
            exitCode: 1,
            rawOutput: [
              " FAIL  tests/unit/auth.test.ts > refresh token",
              "AssertionError: expected token",
              "",
              "Test Files  1 failed | 0 passed",
              "Tests  1 failed | 0 passed"
            ].join("\n"),
            originalChars: 108,
            truncatedApplied: false,
            analysis: analyzeTestStatus([
              " FAIL  tests/unit/auth.test.ts > refresh token",
              "AssertionError: expected token",
              "",
              "Test Files  1 failed | 0 passed",
              "Tests  1 failed | 0 passed"
            ].join("\n"))
          }).analysis,
          pytest: {
            subsetCapable: false,
            failingNodeIds: ["tests/unit/auth.test.ts > refresh token"]
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const { runRerun } = await import("../src/core/rerun.js");
    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: defaultConfig,
        remaining: true
      })
    ).rejects.toThrow(
      "Cached test-status run cannot use `sift rerun --remaining` yet because the original full command is unavailable from cache."
    );
  });
});
