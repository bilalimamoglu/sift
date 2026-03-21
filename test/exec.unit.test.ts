import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScopedTestStatusStatePath } from "../src/constants.js";
import { defaultConfig } from "../src/config/defaults.js";
import {
  BoundedCapture,
  buildCommandPreview,
  getExecSuccessShortcut,
  looksInteractivePrompt,
  normalizeChildExitCode,
  type ExecRequest
} from "../src/core/exec.js";

const { spawnMock, runSiftWithStatsMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  runSiftWithStatsMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("../src/core/run.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/run.js")>(
    "../src/core/run.js"
  );

  return {
    ...actual,
    runSiftWithStats: runSiftWithStatsMock
  };
});

class FakeStream extends EventEmitter {}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
}

function makeRequest(overrides: Partial<ExecRequest> = {}): ExecRequest {
  return {
    question: "did tests pass?",
    format: "brief",
    config: {
      ...defaultConfig,
      runtime: {
        ...defaultConfig.runtime,
        verbose: false
      }
    },
    command: ["node", "-e", "console.log('ok')"],
    ...overrides
  };
}

function readRealFixture(name: string): string {
  return fs.readFileSync(
    path.resolve(import.meta.dirname, "fixtures", "bench", "test-status", "real", name),
    "utf8"
  );
}

function withPatchedStderrTTY(value: boolean): () => void {
  const original = process.stderr.isTTY;
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value
  });

  return () => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: original
    });
  };
}

describe("runExec unit", () => {
  let homeDir = "";
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-exec-home-"));
    stdout = "";
    stderr = "";
    spawnMock.mockReset();
    runSiftWithStatsMock.mockReset();
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

  it("covers bounded capture, prompt detection, and exit-code helpers", () => {
    const capture = new BoundedCapture(10);
    capture.push("hello");
    expect(capture.render()).toBe("hello");
    capture.push(" world!");
    expect(capture.wasTruncated()).toBe(true);
    expect(capture.render()).toContain("...[captured output omitted]...");
    expect(capture.getTotalChars()).toBe(12);
    const overflowedTail = capture.render();
    capture.push("++");
    expect(capture.render()).not.toBe(overflowedTail);

    expect(looksInteractivePrompt("Continue? [y/N]")).toBe(true);
    expect(looksInteractivePrompt("ordinary output")).toBe(false);
    expect(normalizeChildExitCode(2, null)).toBe(2);
    expect(normalizeChildExitCode(null, "SIGTERM")).toBe(143);
    expect(normalizeChildExitCode(null, null)).toBe(1);
    expect(normalizeChildExitCode(null, "SIGUNKNOWN" as NodeJS.Signals)).toBe(1);
    expect(
      buildCommandPreview(
        makeRequest({
          command: ["git", "diff"]
        })
      )
    ).toBe("git diff");
    expect(
      buildCommandPreview(
        makeRequest({
          command: undefined,
          shellCommand: "git diff"
        })
      )
    ).toBe("git diff");
    expect(
      buildCommandPreview(
        makeRequest({
          command: undefined,
          shellCommand: undefined
        })
      )
    ).toBe("");
    expect(
      getExecSuccessShortcut({
        presetName: "typecheck-summary",
        exitCode: 0,
        capturedOutput: ""
      })
    ).toBe("No type errors.");
    expect(
      getExecSuccessShortcut({
        presetName: "typecheck-summary",
        exitCode: 1,
        capturedOutput: ""
      })
    ).toBeNull();
  });

  it("rejects invalid command shapes", async () => {
    const { runExec } = await import("../src/core/exec.js");

    await expect(
      runExec(makeRequest({ command: undefined, shellCommand: undefined }))
    ).rejects.toThrow("Provide either --shell <command> or -- <program> [args...].");

    await expect(
      runExec(makeRequest({ shellCommand: "echo hi" }))
    ).rejects.toThrow("Provide either --shell <command> or -- <program> [args...].");
  });

  it("spawns argv commands and runs the provider path", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Reduced answer", stats: null });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(makeRequest());

    child.stdout.emit("data", "raw output");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(spawnMock).toHaveBeenCalledWith("node", ["-e", "console.log('ok')"], {
      cwd: process.cwd(),
      stdio: ["inherit", "pipe", "pipe"]
    });
    expect(runSiftWithStatsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stdin: "raw output"
      })
    );
    expect(stdout).toContain("Reduced answer");
  });

  it("caches non-interactive test-status runs for later escalation", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Reduced answer", stats: null });
    const statePath = getScopedTestStatusStatePath(process.cwd(), homeDir);
    const rawOutput = [
      "=================== short test summary info ===================",
      "ERROR tests/db/test_users.py - RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN",
      "ERROR tests/db/test_posts.py - RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN",
      "2 errors in 0.12s"
    ].join("\n");

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        presetName: "test-status",
        format: "bullets",
        detail: "standard"
      })
    );

    child.stdout.emit("data", rawOutput);
    child.emit("close", 1, null);

    await expect(pending).resolves.toBe(1);
    expect(fs.existsSync(statePath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      rawOutput: string;
      detail: string;
      exitCode: number;
    };
    expect(stored.rawOutput).toBe(rawOutput);
    expect(stored.detail).toBe("standard");
    expect(stored.exitCode).toBe(1);
  });

  it("prepends diff output for matching cached test-status reruns", async () => {
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    runSiftWithStatsMock.mockResolvedValue({ output: "Reduced answer", stats: null });
    const firstRaw = readRealFixture("snapshot-drift-only.txt");
    const secondRaw = readRealFixture("single-blocker-short.txt");

    const { runExec } = await import("../src/core/exec.js");
    const firstRun = runExec(
      makeRequest({
        presetName: "test-status",
        format: "bullets",
        detail: "standard"
      })
    );
    firstChild.stdout.emit("data", firstRaw);
    firstChild.emit("close", 1, null);
    await expect(firstRun).resolves.toBe(1);

    stdout = "";

    const secondRun = runExec(
      makeRequest({
        presetName: "test-status",
        format: "bullets",
        detail: "standard",
        diff: true
      })
    );
    secondChild.stdout.emit("data", secondRaw);
    secondChild.emit("close", 1, null);

    await expect(secondRun).resolves.toBe(1);
    expect(stdout).toContain("- Resolved:");
    expect(stdout).toContain("- New:");
    expect(stdout).toContain("Reduced answer");
  });

  it("keeps exec working when cache writes fail", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Reduced answer", stats: null });
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        presetName: "test-status",
        format: "bullets",
        config: {
          ...defaultConfig,
          runtime: {
            ...defaultConfig.runtime,
            verbose: true
          }
        }
      })
    );

    child.stdout.emit(
      "data",
      [
        "=================== short test summary info ===================",
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "1 failed in 0.12s"
      ].join("\n")
    );
    child.emit("close", 1, null);

    await expect(pending).resolves.toBe(1);
    expect(writeSpy).toHaveBeenCalled();
    expect(stdout).toContain("Reduced answer");
    expect(stderr).toContain("cache_write=failed");
  });

  it("prints captured raw output to stderr and appends a newline when needed", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Reduced answer", stats: null });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        showRaw: true
      })
    );

    child.stdout.emit("data", "raw output without newline");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(stderr).toContain("raw output without newline\n");
    expect(stdout).toContain("Reduced answer");
  });

  it("prints verbose execution metadata and preserves signal exits", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Reduced answer", stats: null });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        config: {
          ...defaultConfig,
          input: {
            ...defaultConfig.input,
            maxCaptureChars: 8
          },
          runtime: {
            ...defaultConfig.runtime,
            verbose: true
          }
        }
      })
    );

    child.stdout.emit("data", "abcdefghijk");
    child.emit("close", null, "SIGTERM");

    await expect(pending).resolves.toBe(143);
    expect(stderr).toContain("exec mode=argv");
    expect(stderr).toContain("capture_truncated=true");
    expect(runSiftWithStatsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stdin: expect.stringContaining("...[captured output omitted]...")
      })
    );
  });

  it("spawns shell commands when requested", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Shell answer", stats: null });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        command: undefined,
        shellCommand: "printf hi"
      })
    );

    child.stdout.emit("data", "hi");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(spawnMock).toHaveBeenCalledWith(expect.any(String), ["-lc", "printf hi"], {
      cwd: process.cwd(),
      stdio: ["inherit", "pipe", "pipe"]
    });
  });

  it("rewrites insufficient output with exec-aware hints", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({
      output: "Insufficient signal in the provided input.",
      stats: null
    });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        presetName: "test-status",
        format: "bullets"
      })
    );

    child.stdout.emit("data", "opaque test runner output");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(stdout).toContain("Insufficient signal in the provided input.");
    expect(stdout).toContain(
      "Hint: command succeeded, but no recognizable test summary was found."
    );
  });

  it("uses the bash fallback for shell mode and handles buffer chunks", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Shell answer", stats: null });
    const originalShell = process.env.SHELL;
    delete process.env.SHELL;
    try {
      const { runExec } = await import("../src/core/exec.js");
      const pending = runExec(
        makeRequest({
          command: undefined,
          shellCommand: "printf hi",
          config: {
            ...defaultConfig,
            runtime: {
              ...defaultConfig.runtime,
              verbose: true
            }
          }
        })
      );

      child.stdout.emit("data", Buffer.from("hi"));
      child.emit("close", 0, null);

      await expect(pending).resolves.toBe(0);
      expect(spawnMock).toHaveBeenCalledWith("/bin/bash", ["-lc", "printf hi"], {
        cwd: process.cwd(),
        stdio: ["inherit", "pipe", "pipe"]
      });
      expect(stderr).toContain("exec mode=shell");
      expect(runSiftWithStatsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          stdin: "hi"
        })
      );
    } finally {
      process.env.SHELL = originalShell;
    }
  });

  it("short-circuits silent successful typecheck exec runs", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        presetName: "typecheck-summary",
        format: "bullets",
        command: ["node", "-e", "process.exit(0)"]
      })
    );

    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(runSiftWithStatsMock).not.toHaveBeenCalled();
    expect(stdout).toContain("No type errors.");
  });

  it("logs the exec shortcut when verbose mode is enabled", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        presetName: "typecheck-summary",
        format: "bullets",
        command: ["node", "-e", "process.exit(0)"],
        config: {
          ...defaultConfig,
          runtime: {
            ...defaultConfig.runtime,
            verbose: true
          }
        }
      })
    );

    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(stderr).toContain("exec_shortcut=typecheck-summary");
  });

  it("emits a heuristic footer on tty stderr for reduced exec output", async () => {
    const child = new FakeChild();
    const originalStderrIsTTY = process.stderr.isTTY;
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({
      output: "Reduced answer",
      stats: {
        layer: "heuristic",
        providerCalled: false,
        totalTokens: null,
        durationMs: 47,
        presetName: "build-failure"
      }
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true
    });

    try {
      const { runExec } = await import("../src/core/exec.js");
      const pending = runExec(makeRequest({ presetName: "build-failure" }));

      child.stdout.emit("data", "raw output");
      child.emit("close", 0, null);

      await expect(pending).resolves.toBe(0);
      expect(stderr).toContain("[sift: heuristic • LLM skipped • summary 47ms]");
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: originalStderrIsTTY
      });
    }
  });

  it("shows a tiny pending notice on tty stderr while waiting for the child command", async () => {
    const child = new FakeChild();
    const restoreStderrTTY = withPatchedStderrTTY(true);
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: "Reduced answer", stats: null });
    vi.useFakeTimers();

    try {
      const { runExec } = await import("../src/core/exec.js");
      const pending = runExec(makeRequest({ presetName: "build-failure" }));

      child.stdout.emit("data", "raw output");
      await vi.advanceTimersByTimeAsync(160);

      expect(stderr).toContain("sift waiting for child command...");

      child.emit("close", 0, null);

      await expect(pending).resolves.toBe(0);
      expect(stdout).toContain("Reduced answer");
    } finally {
      vi.useRealTimers();
      restoreStderrTTY();
    }
  });

  it("suppresses the child waiting notice when stderr is not a tty or quiet is enabled", async () => {
    const { runExec } = await import("../src/core/exec.js");
    vi.useFakeTimers();

    try {
      const restoreNonTTY = withPatchedStderrTTY(false);
      try {
        const nonTTYChild = new FakeChild();
        spawnMock.mockReturnValueOnce(nonTTYChild);
        runSiftWithStatsMock.mockResolvedValueOnce({ output: "Reduced answer", stats: null });

        const nonTTYPending = runExec(makeRequest({ presetName: "build-failure" }));
        nonTTYChild.stdout.emit("data", "raw output");
        await vi.advanceTimersByTimeAsync(200);
        nonTTYChild.emit("close", 0, null);

        await expect(nonTTYPending).resolves.toBe(0);
        expect(stderr).not.toContain("sift waiting for child command...");
      } finally {
        restoreNonTTY();
      }

      stderr = "";

      const restoreTTY = withPatchedStderrTTY(true);
      try {
        const quietChild = new FakeChild();
        spawnMock.mockReturnValueOnce(quietChild);
        runSiftWithStatsMock.mockResolvedValueOnce({ output: "Reduced answer", stats: null });

        const quietPending = runExec(makeRequest({ presetName: "build-failure", quiet: true }));
        quietChild.stdout.emit("data", "raw output");
        await vi.advanceTimersByTimeAsync(200);
        quietChild.emit("close", 0, null);

        await expect(quietPending).resolves.toBe(0);
        expect(stderr).not.toContain("sift waiting for child command...");
      } finally {
        restoreTTY();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits a provider footer with usage tokens on tty stderr", async () => {
    const child = new FakeChild();
    const originalStderrIsTTY = process.stderr.isTTY;
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({
      output: "Provider answer",
      stats: {
        layer: "provider",
        providerCalled: true,
        totalTokens: 380,
        durationMs: 1200,
        presetName: undefined
      }
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true
    });

    try {
      const { runExec } = await import("../src/core/exec.js");
      const pending = runExec(makeRequest());

      child.stdout.emit("data", "raw output");
      child.emit("close", 0, null);

      await expect(pending).resolves.toBe(0);
      expect(stderr).toContain("[sift: provider • LLM used • 380 tokens • summary 1.2s]");
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: originalStderrIsTTY
      });
    }
  });

  it("suppresses the footer when quiet is enabled or stderr is not a tty", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({
      output: "Reduced answer",
      stats: {
        layer: "heuristic",
        providerCalled: false,
        totalTokens: null,
        durationMs: 47,
        presetName: "typecheck-summary"
      }
    });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(makeRequest({ presetName: "typecheck-summary", quiet: true }));

    child.stdout.emit("data", "raw output");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(stderr).not.toContain("[sift:");
  });

  it("emits a heuristic footer for exec shortcuts on tty stderr", async () => {
    const child = new FakeChild();
    const originalStderrIsTTY = process.stderr.isTTY;
    spawnMock.mockReturnValue(child);
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true
    });

    try {
      const { runExec } = await import("../src/core/exec.js");
      const pending = runExec(
        makeRequest({
          presetName: "typecheck-summary",
          format: "bullets",
          command: ["node", "-e", "process.exit(0)"]
        })
      );

      child.emit("close", 0, null);

      await expect(pending).resolves.toBe(0);
      expect(stderr).toContain("[sift: heuristic • LLM skipped • summary ");
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: originalStderrIsTTY
      });
    }
  });

  it("bypasses reduction for interactive prompt-like output", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const statePath = getScopedTestStatusStatePath(process.cwd(), homeDir);

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        command: ["node", "-e", "process.stdout.write('Continue? [y/N]')"],
        presetName: "test-status",
        format: "bullets"
      })
    );

    child.stdout.emit("data", "Continue? [y/N]");
    child.stdout.emit("data", "remaining output");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(runSiftWithStatsMock).not.toHaveBeenCalled();
    expect(stderr).toContain("Continue? [y/N]");
    expect(stderr).toContain("remaining output");
    expect(stderr).not.toContain("[sift:");
    expect(fs.existsSync(statePath)).toBe(false);
  });

  it("logs interactive bypasses in verbose mode", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        command: ["node", "-e", "process.stdout.write('Continue? [y/N]')"],
        config: {
          ...defaultConfig,
          runtime: {
            ...defaultConfig.runtime,
            verbose: true
          }
        }
      })
    );

    child.stdout.emit("data", "Continue? [y/N]");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
    expect(stderr).toContain("bypass=interactive-prompt");
  });

  it("preserves child non-zero exits even when fail-on would trigger", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({
      output: JSON.stringify({
        verdict: "fail",
        reason: "risky",
        evidence: []
      }),
      stats: null
    });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        failOn: true,
        presetName: "infra-risk",
        format: "verdict"
      })
    );

    child.stdout.emit("data", "Plan: 1 to destroy");
    child.emit("close", 2, null);

    await expect(pending).resolves.toBe(2);
  });

  it("upgrades exit 0 to 1 when fail-on gate trips", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({
      output: JSON.stringify({
        status: "ok",
        vulnerabilities: [{ package: "lodash", severity: "critical" }],
        summary: "bad"
      }),
      stats: null
    });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        failOn: true,
        presetName: "audit-critical",
        format: "json"
      })
    );

    child.stdout.emit("data", "lodash: critical vulnerability");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(1);
  });

  it("skips fail-on when dry-run is enabled", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    runSiftWithStatsMock.mockResolvedValue({ output: '{"status":"dry-run"}', stats: null });

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(
      makeRequest({
        dryRun: true,
        failOn: true,
        presetName: "audit-critical",
        format: "json"
      })
    );

    child.stdout.emit("data", "input");
    child.emit("close", 0, null);

    await expect(pending).resolves.toBe(0);
  });

  it("throws child spawn errors", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(makeRequest());

    child.emit("error", new Error("spawn failed"));

    await expect(pending).rejects.toThrow("spawn failed");
  });

  it("normalizes non-Error child startup failures", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const { runExec } = await import("../src/core/exec.js");
    const pending = runExec(makeRequest());

    child.emit("error", "spawn failed");

    await expect(pending).rejects.toThrow("Failed to start child process.");
  });
});
