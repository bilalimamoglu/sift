import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import {
  matchHookCommand,
  runHook,
  showHookMatch
} from "../src/commands/hook.js";

describe("hook beta", () => {
  it("matches only the known direct command allowlist", () => {
    expect(matchHookCommand({ command: ["pytest", "-q"] })).toMatchObject({
      matched: true,
      presetName: "test-status"
    });
    expect(matchHookCommand({ command: ["python", "-m", "pytest"] })).toMatchObject({
      matched: true,
      presetName: "test-status"
    });
    expect(matchHookCommand({ command: ["tsc", "--noEmit"] })).toMatchObject({
      matched: true,
      presetName: "typecheck-summary"
    });
    expect(matchHookCommand({ command: ["npm", "audit"] })).toMatchObject({
      matched: true,
      presetName: "audit-critical"
    });
    expect(matchHookCommand({ command: ["terraform", "plan"] })).toMatchObject({
      matched: true,
      presetName: "infra-risk"
    });
    expect(matchHookCommand({ command: ["git", "diff", "--stat"] })).toMatchObject({
      matched: true,
      presetName: "diff-summary"
    });

    expect(matchHookCommand({ command: ["./node_modules/.bin/vitest"] })).toMatchObject({
      matched: false
    });
    expect(matchHookCommand({ command: ["npm", "test"] })).toMatchObject({
      matched: false
    });
    expect(matchHookCommand({ command: ["sift", "exec"] })).toMatchObject({
      matched: false
    });
  });

  it("matches known shell commands conservatively", () => {
    expect(matchHookCommand({ shellCommand: "pytest -q" })).toMatchObject({
      matched: true,
      presetName: "test-status"
    });
    expect(matchHookCommand({ shellCommand: "npm audit --json" })).toMatchObject({
      matched: true,
      presetName: "audit-critical"
    });
    expect(matchHookCommand({ shellCommand: " ./node_modules/.bin/vitest " })).toMatchObject({
      matched: false
    });
    expect(matchHookCommand({ shellCommand: "CI=1 pytest -q" })).toMatchObject({
      matched: false
    });
  });

  it("prints a human-readable match explanation", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      showHookMatch({ command: ["pytest", "-q"] });
      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining("decision: matched")
      );
      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining("preset: test-status")
      );
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("routes matched commands through runExec with the preset contract", async () => {
    const runExecMock = vi.fn().mockResolvedValue(0);
    const runRawMock = vi.fn().mockResolvedValue(0);

    await expect(
      runHook(
        {
          command: ["pytest", "-q"],
          config: defaultConfig,
          quiet: true
        },
        {
          runExec: runExecMock,
          runRaw: runRawMock
        }
      )
    ).resolves.toBe(0);

    expect(runExecMock).toHaveBeenCalledWith(
      expect.objectContaining({
        presetName: "test-status",
        question: "Did the tests pass? If not, list only the failing tests or suites.",
        command: ["pytest", "-q"]
      })
    );
    expect(runRawMock).not.toHaveBeenCalled();
  });

  it("passes unknown commands straight through to the raw command path", async () => {
    const runExecMock = vi.fn().mockResolvedValue(0);
    const runRawMock = vi.fn().mockResolvedValue(7);

    await expect(
      runHook(
        {
          command: ["npm", "test"],
          config: defaultConfig,
          quiet: true
        },
        {
          runExec: runExecMock,
          runRaw: runRawMock
        }
      )
    ).resolves.toBe(7);

    expect(runExecMock).not.toHaveBeenCalled();
    expect(runRawMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["npm", "test"]
      })
    );
  });

  it("falls back to the raw command path if the matched reduction path throws", async () => {
    const runExecMock = vi.fn().mockRejectedValue(new Error("boom"));
    const runRawMock = vi.fn().mockResolvedValue(3);

    await expect(
      runHook(
        {
          command: ["terraform", "plan"],
          config: defaultConfig,
          quiet: true
        },
        {
          runExec: runExecMock,
          runRaw: runRawMock
        }
      )
    ).resolves.toBe(3);

    expect(runExecMock).toHaveBeenCalledTimes(1);
    expect(runRawMock).toHaveBeenCalledTimes(1);
  });
});
