import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { getScopedTestStatusStatePath } from "../src/constants.js";

const { runSiftWithStatsMock } = vi.hoisted(() => ({
  runSiftWithStatsMock: vi.fn()
}));

// These integration tests mock runSiftWithStats so they verify rerun/escalate
// orchestration, cache scope, and output plumbing without re-testing the
// reduction internals in run.ts.
vi.mock("../src/core/run.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/run.js")>(
    "../src/core/run.js"
  );

  return {
    ...actual,
    runSiftWithStats: runSiftWithStatsMock
  };
});

function buildDiagnoseOutput(args: { remainingMode?: string; remainingTests?: string[]; remainingSubsetAvailable?: boolean }) {
  const remainingTests = args.remainingTests ?? [];
  const families = new Map<string, number>();

  for (const target of remainingTests) {
    const prefix = target.includes("/")
      ? `${target.slice(0, target.lastIndexOf("/") + 1)}`
      : target;
    families.set(prefix, (families.get(prefix) ?? 0) + 1);
  }

  return JSON.stringify({
    remaining_mode: args.remainingMode ?? "none",
    remaining_subset_available: Boolean(args.remainingSubsetAvailable),
    remaining_summary: {
      count: remainingTests.length,
      families: [...families.entries()].map(([prefix, count]) => ({
        prefix,
        count
      }))
    }
  });
}

function extractVisibleTargets(input: string): string[] {
  const targets = new Set<string>();

  for (const line of input.split(/\r?\n/)) {
    const pytestMatch = line.match(/^(?:FAILED|ERROR)\s+(.+?)\s+-\s+/);
    if (pytestMatch) {
      targets.add(pytestMatch[1]!);
      continue;
    }

    const vitestMatch = line.match(/^\s*FAIL\s+(.+)$/);
    if (vitestMatch) {
      targets.add(vitestMatch[1]!.trim());
      continue;
    }
  }

  return [...targets];
}

function buildMockedReductionOutput(request: {
  detail?: "standard" | "focused" | "verbose";
  goal?: string;
  format: string;
  stdin: string;
  testStatusContext?: {
    remainingMode?: string;
    remainingSubsetAvailable?: boolean;
    remainingTests?: string[];
  };
}) {
  if (request.goal === "diagnose" && request.format === "json") {
    return buildDiagnoseOutput({
      remainingMode: request.testStatusContext?.remainingMode,
      remainingSubsetAvailable: request.testStatusContext?.remainingSubsetAvailable,
      remainingTests: request.testStatusContext?.remainingTests
    });
  }

  const remainingTests =
    request.testStatusContext?.remainingTests && request.testStatusContext.remainingTests.length > 0
      ? request.testStatusContext.remainingTests
      : request.testStatusContext?.remainingMode &&
          request.testStatusContext.remainingMode !== "none"
        ? extractVisibleTargets(request.stdin)
        : [];
  if (remainingTests.length > 0) {
    return `Remaining: ${remainingTests.join(", ")}`;
  }

  if (request.detail === "focused") {
    return "Focused: tests/unit/test_auth.py::test_refresh";
  }

  if (request.detail === "verbose") {
    return "Verbose: tests/unit/test_auth.py::test_refresh";
  }

  if (request.stdin.includes("AssertionError")) {
    return "Tests did not pass";
  }

  return "Tests passed";
}

function makeBaseConfig() {
  return {
    ...defaultConfig,
    runtime: {
      ...defaultConfig.runtime,
      verbose: false
    }
  };
}

async function writeExecutable(filePath: string, source: string): Promise<void> {
  await fs.promises.writeFile(filePath, source, {
    encoding: "utf8",
    mode: 0o755
  });
}

describe("test-status integration", () => {
  let homeDir = "";
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-test-status-int-home-"));
    stdout = "";
    stderr = "";
    runSiftWithStatsMock.mockReset();
    runSiftWithStatsMock.mockImplementation(async (request) => ({
      output: buildMockedReductionOutput(request),
      stats: null
    }));
    vi.spyOn(os, "homedir").mockReturnValue(homeDir);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the cached test-status run during escalate without rerunning the child command", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-escalate-int-cwd-"));
    const counterPath = path.join(cwd, "counter.txt");
    const statePath = getScopedTestStatusStatePath(cwd, homeDir);
    const script = [
      "const fs = require('node:fs');",
      "fs.appendFileSync(process.argv[1], 'x');",
      "console.error('FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token');",
      "process.exit(1);"
    ].join(" ");

    const { runExec } = await import("../src/core/exec.js");
    const { runEscalate } = await import("../src/core/escalate.js");

    await expect(
      runExec({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        presetName: "test-status",
        detail: "standard",
        cwd,
        command: [process.execPath, "-e", script, counterPath]
      })
    ).resolves.toBe(1);

    expect(await fs.promises.readFile(counterPath, "utf8")).toBe("x");
    expect(JSON.parse(await fs.promises.readFile(statePath, "utf8")).detail).toBe("standard");

    stdout = "";
    stderr = "";
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    await expect(
      runEscalate({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        showRaw: true
      })
    ).resolves.toBe(1);

    expect(await fs.promises.readFile(counterPath, "utf8")).toBe("x");
    expect(stdout).toContain("Focused: tests/unit/test_auth.py::test_refresh");
    expect(stderr).toContain(
      "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token"
    );
    expect(JSON.parse(await fs.promises.readFile(statePath, "utf8")).detail).toBe("focused");

    stdout = "";

    await expect(
      runEscalate({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig()
      })
    ).resolves.toBe(1);

    expect(stdout).toContain("Verbose: tests/unit/test_auth.py::test_refresh");
    expect(JSON.parse(await fs.promises.readFile(statePath, "utf8")).detail).toBe("verbose");
  });

  it("does not reuse another directory's cached test-status run during escalate", async () => {
    const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), "sift-escalate-int-a-"));
    const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), "sift-escalate-int-b-"));
    const counterPath = path.join(cwdA, "counter.txt");
    const script = [
      "const fs = require('node:fs');",
      "fs.appendFileSync(process.argv[1], 'x');",
      "console.error('FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token');",
      "process.exit(1);"
    ].join(" ");

    const { runExec } = await import("../src/core/exec.js");
    const { runEscalate } = await import("../src/core/escalate.js");

    await expect(
      runExec({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        presetName: "test-status",
        detail: "standard",
        cwd: cwdA,
        command: [process.execPath, "-e", script, counterPath]
      })
    ).resolves.toBe(1);

    vi.spyOn(process, "cwd").mockReturnValue(cwdB);

    await expect(
      runEscalate({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig()
      })
    ).rejects.toThrow(
      "No cached test-status run found. Start with `sift exec --preset test-status -- <test command>`."
    );
  });

  it("reruns the remaining pytest subset without rewriting the cached baseline", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-rerun-int-cwd-"));
    const pytestPath = path.join(cwd, "pytest");
    const outputPath = path.join(cwd, "pytest-output.txt");
    const argsLogPath = path.join(cwd, "pytest-args.log");
    const statePath = getScopedTestStatusStatePath(cwd, homeDir);
    const script = [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cwd = process.cwd();",
      "fs.appendFileSync(path.join(cwd, 'pytest-args.log'), JSON.stringify(process.argv.slice(2)) + '\\n');",
      "const output = fs.readFileSync(path.join(cwd, 'pytest-output.txt'), 'utf8');",
      "process.stdout.write(output);",
      "process.exit(/(?:^FAILED |^ERROR |\\b\\d+\\s+failed\\b|\\b\\d+\\s+errors?\\b)/m.test(output) ? 1 : 0);"
    ].join("\n");

    await writeExecutable(pytestPath, script);
    await fs.promises.writeFile(
      outputPath,
      [
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "2 failed in 0.12s"
      ].join("\n"),
      "utf8"
    );

    const { runExec } = await import("../src/core/exec.js");
    const { runRerun } = await import("../src/core/rerun.js");

    await expect(
      runExec({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        presetName: "test-status",
        detail: "standard",
        cwd,
        command: ["./pytest"]
      })
    ).resolves.toBe(1);

    await fs.promises.writeFile(
      outputPath,
      [
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "1 failed in 0.12s"
      ].join("\n"),
      "utf8"
    );

    stdout = "";
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig()
      })
    ).resolves.toBe(1);

    expect(stdout).toContain("Remaining: tests/unit/test_users.py::test_list");

    const fullRerunState = JSON.parse(await fs.promises.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };

    stdout = "";

    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        remaining: true,
        detail: "verbose"
      })
    ).resolves.toBe(1);

    expect(stdout).toContain("Remaining: tests/unit/test_users.py::test_list");
    expect(stdout).not.toContain("tests/unit/test_auth.py::test_refresh");

    const argLog = (await fs.promises.readFile(argsLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(argLog).toEqual([[], [], ["tests/unit/test_users.py::test_list"]]);

    const stateAfterRerun = JSON.parse(await fs.promises.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };
    expect(stateAfterRerun.rawOutput).toBe(fullRerunState.rawOutput);
    expect(runSiftWithStatsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        testStatusContext: expect.objectContaining({
          remainingMode: "subset_rerun"
        })
      })
    );
  });

  it("uses a full-rerun diff for vitest remaining reruns and preserves the baseline", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-vitest-int-cwd-"));
    const vitestPath = path.join(cwd, "vitest");
    const outputPath = path.join(cwd, "vitest-output.txt");
    const argsLogPath = path.join(cwd, "vitest-args.log");
    const statePath = getScopedTestStatusStatePath(cwd, homeDir);
    const script = [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cwd = process.cwd();",
      "fs.appendFileSync(path.join(cwd, 'vitest-args.log'), JSON.stringify(process.argv.slice(2)) + '\\n');",
      "const output = fs.readFileSync(path.join(cwd, 'vitest-output.txt'), 'utf8');",
      "process.stdout.write(output);",
      "process.exit(/(?:^\\s*FAIL |\\b\\d+\\s+failed\\b)/m.test(output) ? 1 : 0);"
    ].join("\n");

    await writeExecutable(vitestPath, script);
    await fs.promises.writeFile(
      outputPath,
      [
        " FAIL  tests/ui/auth.test.ts > refresh token",
        "AssertionError: expected token",
        "",
        " FAIL  tests/ui/users.test.ts > list users",
        "AssertionError: expected user",
        "",
        " Test Files  2 failed | 0 passed",
        " Tests  2 failed | 0 passed"
      ].join("\n"),
      "utf8"
    );

    const { runExec } = await import("../src/core/exec.js");
    const { runRerun } = await import("../src/core/rerun.js");

    await expect(
      runExec({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        presetName: "test-status",
        detail: "standard",
        cwd,
        command: ["./vitest", "run"]
      })
    ).resolves.toBe(1);

    const originalState = JSON.parse(await fs.promises.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };

    await fs.promises.writeFile(
      outputPath,
      [
        " FAIL  tests/ui/users.test.ts > list users",
        "AssertionError: expected user",
        "",
        " Test Files  1 failed | 0 passed",
        " Tests  1 failed | 0 passed"
      ].join("\n"),
      "utf8"
    );

    stdout = "";
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        remaining: true
      })
    ).resolves.toBe(1);

    expect(stdout).toContain("Remaining: tests/ui/users.test.ts > list users");
    expect(stdout).not.toContain("tests/ui/auth.test.ts > refresh token");

    const argLog = (await fs.promises.readFile(argsLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(argLog).toEqual([["run"], ["run"]]);

    const stateAfterRerun = JSON.parse(await fs.promises.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };
    expect(stateAfterRerun.rawOutput).toBe(originalState.rawOutput);
    expect(runSiftWithStatsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        testStatusContext: expect.objectContaining({
          remainingMode: "full_rerun_diff",
          remainingSubsetAvailable: false
        })
      })
    );
  });

  it("returns summary-first diagnose JSON for jest remaining reruns", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-jest-int-cwd-"));
    const jestPath = path.join(cwd, "jest");
    const outputPath = path.join(cwd, "jest-output.txt");
    const statePath = getScopedTestStatusStatePath(cwd, homeDir);
    const script = [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const output = fs.readFileSync(path.join(process.cwd(), 'jest-output.txt'), 'utf8');",
      "process.stdout.write(output);",
      "process.exit(/(?:^FAIL |\\bfailed\\b)/m.test(output) ? 1 : 0);"
    ].join("\n");

    await writeExecutable(jestPath, script);
    await fs.promises.writeFile(
      outputPath,
      [
        "FAIL tests/ui/auth.test.ts",
        "  × refresh token",
        "    AssertionError: expected token",
        "",
        "FAIL tests/ui/users.test.ts",
        "  × list users",
        "    AssertionError: expected user",
        "",
        "Test Suites: 2 failed, 2 total",
        "Tests:       2 failed, 2 total",
        "Snapshots:   0 total",
        "Time:        1.234 s",
        "Ran all test suites."
      ].join("\n"),
      "utf8"
    );

    const { runExec } = await import("../src/core/exec.js");
    const { runRerun } = await import("../src/core/rerun.js");

    await expect(
      runExec({
        question: "Did the tests pass?",
        format: "bullets",
        config: makeBaseConfig(),
        presetName: "test-status",
        detail: "standard",
        cwd,
        command: ["./jest"]
      })
    ).resolves.toBe(1);

    const originalState = JSON.parse(await fs.promises.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };

    await fs.promises.writeFile(
      outputPath,
      [
        "FAIL tests/ui/users.test.ts",
        "  × list users",
        "    AssertionError: expected user",
        "",
        "Test Suites: 1 failed, 1 total",
        "Tests:       1 failed, 1 total",
        "Snapshots:   0 total",
        "Time:        0.987 s",
        "Ran all test suites."
      ].join("\n"),
      "utf8"
    );

    stdout = "";
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    await expect(
      runRerun({
        question: "Did the tests pass?",
        format: "json",
        goal: "diagnose",
        config: makeBaseConfig(),
        remaining: true
      })
    ).resolves.toBe(1);

    const parsed = JSON.parse(stdout) as {
      remaining_mode: string;
      remaining_subset_available: boolean;
      remaining_summary: { count: number; families: Array<{ prefix: string; count: number }> };
    };
    expect(parsed.remaining_mode).toBe("full_rerun_diff");
    expect(parsed.remaining_subset_available).toBe(false);
    expect(parsed.remaining_summary.count).toBe(1);
    expect(parsed.remaining_summary.families).toEqual([
      {
        prefix: "tests/ui/",
        count: 1
      }
    ]);

    const stateAfterRerun = JSON.parse(await fs.promises.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };
    expect(stateAfterRerun.rawOutput).toBe(originalState.rawOutput);
  });
});
