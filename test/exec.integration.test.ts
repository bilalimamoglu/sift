import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { getScopedTestStatusStatePath } from "../src/constants.js";
import type { ExecRequest } from "../src/core/exec.js";

const { runSiftWithStatsMock } = vi.hoisted(() => ({
  runSiftWithStatsMock: vi.fn()
}));

// These integration tests mock runSiftWithStats so they exercise real child
// process orchestration, cache behavior, and IO plumbing without re-testing
// reduction internals.
vi.mock("../src/core/run.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/run.js")>(
    "../src/core/run.js"
  );

  return {
    ...actual,
    runSiftWithStats: runSiftWithStatsMock
  };
});

function writeFixtureScript(args: {
  cwd: string;
  filename: string;
  fixtureName: string;
}): string {
  // Keep large fixture payloads out of `node -e "...huge string..."` argv blobs.
  // That can pass locally on macOS but trip Linux CI spawn limits with E2BIG.
  const fixturePath = path.resolve(
    import.meta.dirname,
    "fixtures",
    "bench",
    "test-status",
    "real",
    args.fixtureName
  );
  const scriptPath = path.join(args.cwd, args.filename);
  fs.writeFileSync(
    scriptPath,
    [
      'import fs from "node:fs";',
      `const fixturePath = ${JSON.stringify(fixturePath)};`,
      "process.stdout.write(fs.readFileSync(fixturePath, 'utf8'));",
      "process.exit(1);"
    ].join("\n"),
    "utf8"
  );
  return scriptPath;
}

function makeRequest(overrides: Partial<ExecRequest> = {}): ExecRequest {
  return {
    question: "did the tests pass?",
    format: "brief",
    config: {
      ...defaultConfig,
      runtime: {
        ...defaultConfig.runtime,
        verbose: false
      }
    },
    command: [process.execPath, "-e", "console.log('ok')"],
    ...overrides
  };
}

describe("runExec integration", () => {
  let homeDir = "";
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-exec-int-home-"));
    stdout = "";
    stderr = "";
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

  it("runs a real child process and forwards captured output into reduction", async () => {
    runSiftWithStatsMock.mockResolvedValue({
      output: "Reduced answer",
      stats: null
    });

    const { runExec } = await import("../src/core/exec.js");
    await expect(
      runExec(
        makeRequest({
          command: [process.execPath, "-e", "console.log('raw output')"]
        })
      )
    ).resolves.toBe(0);

    expect(runSiftWithStatsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stdin: "raw output\n"
      })
    );
    expect(stdout).toContain("Reduced answer");
  });

  it("mirrors captured raw output to stderr when showRaw is enabled", async () => {
    runSiftWithStatsMock.mockResolvedValue({
      output: "Reduced answer",
      stats: null
    });

    const { runExec } = await import("../src/core/exec.js");
    await expect(
      runExec(
        makeRequest({
          showRaw: true,
          command: [process.execPath, "-e", "console.log('line 1'); console.error('line 2');"]
        })
      )
    ).resolves.toBe(0);

    expect(stdout).toContain("Reduced answer");
    expect(stderr).toContain("line 1");
    expect(stderr).toContain("line 2");
  });

  it("prepends diff lines for same-cwd test-status reruns", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-exec-int-cwd-"));
    const statePath = getScopedTestStatusStatePath(cwd, homeDir);
    const firstScriptPath = writeFixtureScript({
      cwd,
      filename: "first-fixture.mjs",
      fixtureName: "snapshot-drift-only.txt"
    });
    const secondScriptPath = writeFixtureScript({
      cwd,
      filename: "second-fixture.mjs",
      fixtureName: "single-blocker-short.txt"
    });
    runSiftWithStatsMock.mockResolvedValue({
      output: "Tests did not pass",
      stats: null
    });

    const { runExec } = await import("../src/core/exec.js");
    await expect(
      runExec(
        makeRequest({
          cwd,
          presetName: "test-status",
          format: "bullets",
          detail: "standard",
          command: [process.execPath, firstScriptPath]
        })
      )
    ).resolves.toBe(1);

    expect(fs.existsSync(statePath)).toBe(true);

    stdout = "";

    await expect(
      runExec(
        makeRequest({
          cwd,
          presetName: "test-status",
          format: "bullets",
          detail: "standard",
          diff: true,
          command: [process.execPath, secondScriptPath]
        })
      )
    ).resolves.toBe(1);

    expect(stdout).toContain("- Resolved:");
    expect(stdout).toContain("- New:");
    expect(stdout).toContain("Tests did not pass");
  });
});
