import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import {
  assertSupportedGoal,
  assertSupportedIncludeTestIds,
  buildCliOverrides,
  cleanHelpSectionBody,
  createCliApp,
  extractExecCommand,
  handleCliError,
  normalizeGoal,
  normalizeEscalateDetail,
  normalizeDetail,
  resolveExecDiff,
  resolveDetail,
  resolveRerunDetail,
  runCli,
  toNumber,
  type CliDeps
} from "../src/cli-app.js";

function createDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    installAgent: vi.fn().mockResolvedValue(0),
    removeAgent: vi.fn().mockResolvedValue(0),
    showAgent: vi.fn(),
    statusAgents: vi.fn(),
    configInit: vi.fn(),
    configSetup: vi.fn().mockResolvedValue(0),
    configShow: vi.fn(),
    configUse: vi.fn(),
    configValidate: vi.fn(),
    runDoctor: vi.fn().mockReturnValue(0),
    listPresets: vi.fn(),
    showPreset: vi.fn(),
    resolveConfig: vi.fn().mockReturnValue(defaultConfig),
    findConfigPath: vi.fn().mockReturnValue("/tmp/sift.config.yaml"),
    runEscalate: vi.fn().mockResolvedValue(1),
    runExec: vi.fn().mockResolvedValue(0),
    runRerun: vi.fn().mockResolvedValue(0),
    assertSupportedFailOnFormat: vi.fn(),
    assertSupportedFailOnPreset: vi.fn(),
    evaluateGate: vi.fn().mockReturnValue({ shouldFail: true }),
    readStdin: vi.fn().mockResolvedValue("stdin"),
    runSift: vi.fn().mockResolvedValue("Reduced answer"),
    runWatch: vi.fn().mockResolvedValue("Watch answer"),
    looksLikeWatchStream: vi.fn().mockReturnValue(false),
    getPreset: vi.fn().mockImplementation((_config, name: string) => {
      if (name === "infra-risk") {
        return {
          question: "Assess infra risk.",
          format: "verdict",
          policy: "infra-risk",
          outputContract: undefined,
          fallbackJson: undefined
        };
      }

      return {
        question: "Did the tests pass?",
        format: "bullets",
        policy: "test-status",
        outputContract: undefined,
        fallbackJson: undefined
      };
    }),
    ...overrides
  };
}

function captureStreams() {
  let stdout = "";
  let stderr = "";
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    });
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    });

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    restore() {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  };
}

async function runMatched(
  argv: string[],
  deps: CliDeps,
  streamOverrides: { stdoutIsTTY?: boolean; stderrIsTTY?: boolean } = {}
) {
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;
  const cli = createCliApp({
    deps,
    env: {},
    stdout: process.stdout,
    stderr: process.stderr,
    version: "0.3.2"
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: streamOverrides.stdoutIsTTY ?? false
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: streamOverrides.stderrIsTTY ?? false
  });
  try {
    cli.parse(["node", "sift", ...argv], { run: false });
    await cli.runMatchedCommand();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalStdoutIsTTY
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: originalStderrIsTTY
    });
  }
}

describe("cli app unit", () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("covers toNumber and buildCliOverrides", () => {
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber("")).toBeUndefined();
    expect(toNumber("12")).toBe(12);

    expect(buildCliOverrides({})).toEqual({});
    expect(
      buildCliOverrides({
        provider: "openai",
        model: "gpt-5-nano",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "secret",
        jsonResponseFormat: "on",
        timeoutMs: "1234",
        maxCaptureChars: "400",
        maxInputChars: "300",
        headChars: "100",
        tailChars: "100",
        redact: true,
        redactStrict: false,
        stripAnsi: true,
        rawFallback: true,
        verbose: true
      })
    ).toEqual({
      provider: {
        provider: "openai",
        model: "gpt-5-nano",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "secret",
        jsonResponseFormat: "on",
        timeoutMs: 1234
      },
      input: {
        maxCaptureChars: 400,
        maxInputChars: 300,
        headChars: 100,
        tailChars: 100,
        redact: true,
        redactStrict: false,
        stripAnsi: true
      },
      runtime: {
        rawFallback: true,
        verbose: true
      }
    });
  });

  it("covers detail parsing helpers directly", () => {
    expect(normalizeGoal(undefined)).toBeUndefined();
    expect(normalizeGoal("summarize")).toBe("summarize");
    expect(normalizeGoal("diagnose")).toBe("diagnose");
    expect(() => normalizeGoal("fix")).toThrow(
      "Invalid --goal value. Use summarize or diagnose."
    );

    expect(normalizeDetail(undefined)).toBeUndefined();
    expect(normalizeDetail("standard")).toBe("standard");
    expect(normalizeDetail("focused")).toBe("focused");
    expect(normalizeDetail("verbose")).toBe("verbose");
    expect(() => normalizeDetail("full")).toThrow(
      "Invalid --detail value. Use standard, focused, or verbose."
    );

    expect(resolveDetail({ presetName: "test-status", options: {} })).toBe("standard");
    expect(resolveDetail({ presetName: "test-status", options: { detail: "focused" } })).toBe(
      "focused"
    );
    expect(resolveDetail({ presetName: "test-status", options: { detail: "verbose" } })).toBe(
      "verbose"
    );
    expect(resolveDetail({ presetName: "infra-risk", options: {} })).toBeUndefined();
    expect(() =>
      resolveDetail({ presetName: "infra-risk", options: { detail: "focused" } })
    ).toThrow("--detail is supported only with --preset test-status.");

    expect(normalizeEscalateDetail(undefined)).toBeUndefined();
    expect(normalizeEscalateDetail("focused")).toBe("focused");
    expect(normalizeEscalateDetail("verbose")).toBe("verbose");
    expect(() => normalizeEscalateDetail("standard")).toThrow(
      "Invalid --detail value. Use focused or verbose."
    );

    expect(resolveExecDiff({ presetName: "test-status", options: { diff: true } })).toBe(true);
    expect(resolveExecDiff({ presetName: "test-status", options: {} })).toBe(false);
    expect(() => resolveExecDiff({ presetName: "infra-risk", options: { diff: true } })).toThrow(
      "--diff is supported only with --preset test-status."
    );

    expect(resolveRerunDetail({ remaining: true, options: {} })).toBe("standard");
    expect(
      resolveRerunDetail({ remaining: true, options: { detail: "focused" } })
    ).toBe("focused");
    expect(
      resolveRerunDetail({ remaining: true, options: { detail: "verbose" } })
    ).toBe("verbose");
    expect(() =>
      resolveRerunDetail({ remaining: false, options: { detail: "focused" } })
    ).toThrow("--detail is supported only with `sift rerun --remaining`.");

    expect(() =>
      assertSupportedGoal({
        goal: "diagnose",
        format: "json"
      })
    ).toThrow(
      "`--goal diagnose --format json` is currently supported only for `--preset test-status`, `sift rerun`, and `test-status` watch flows."
    );
    expect(() =>
      assertSupportedGoal({
        goal: "diagnose",
        format: "json",
        presetName: "test-status"
      })
    ).not.toThrow();
    expect(() =>
      assertSupportedIncludeTestIds({
        includeTestIds: true,
        goal: "summarize",
        format: "json",
        presetName: "test-status"
      })
    ).toThrow(
      "`--include-test-ids` is supported only with `--goal diagnose --format json` on `--preset test-status`, `sift rerun`, and `test-status` watch flows."
    );
    expect(() =>
      assertSupportedIncludeTestIds({
        includeTestIds: true,
        goal: "diagnose",
        format: "json",
        presetName: "test-status"
      })
    ).not.toThrow();
  });

  it("cleans duplicate version text only for string help sections", () => {
    expect(cleanHelpSectionBody("sift/0.3.2\n\nUsage:\n", "0\\.3\\.2")).toBe(
      "\nUsage:\n"
    );
    expect(cleanHelpSectionBody("Usage:\n", "0\\.3\\.0")).toBe("Usage:\n");
  });

  it("extractExecCommand validates command shape", () => {
    expect(extractExecCommand({ "--": ["git", "diff"] })).toEqual({
      command: ["git", "diff"],
      shellCommand: undefined
    });
    expect(extractExecCommand({ shell: "git diff" })).toEqual({
      command: undefined,
      shellCommand: "git diff"
    });
    expect(() => extractExecCommand({ shell: "x", "--": ["y"] })).toThrow(
      "Use either --shell <command> or -- <program> [args...], not both."
    );
    expect(() => extractExecCommand({})).toThrow("Missing command to execute.");
  });

  it("routes auto-detected piped watch streams through runWatch", async () => {
    const deps = createDeps({
      looksLikeWatchStream: vi.fn().mockReturnValue(true)
    });

    await runMatched(["watch", "what changed?"], deps);

    expect(deps.runWatch).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "what changed?",
        goal: "summarize"
      })
    );
  });

  it("passes watch and diagnose options through exec and watch commands", async () => {
    const deps = createDeps();

    await runMatched(
      ["exec", "--preset", "test-status", "--watch", "--goal", "diagnose", "--format", "json", "--include-test-ids", "--", "pytest"],
      deps
    );
    expect(deps.runExec).toHaveBeenCalledWith(
      expect.objectContaining({
        watch: true,
        goal: "diagnose",
        format: "json",
        includeTestIds: true,
        presetName: "test-status"
      })
    );

    await runMatched(
      ["watch", "--preset", "test-status", "--goal", "diagnose", "--format", "json"],
      deps
    );
    expect(deps.runWatch).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "diagnose",
        format: "json",
        presetName: "test-status"
      })
    );
  });

  it("handles help output and tty/non-tty errors", async () => {
    const deps = createDeps();
    const streams = captureStreams();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdout = process.stdout as NodeJS.WriteStream;
    const stderr = process.stderr as NodeJS.WriteStream;
    const stdoutTty = Object.create(stdout) as NodeJS.WriteStream;
    const stderrPlain = Object.create(stderr) as NodeJS.WriteStream;
    const stderrTty = Object.create(stderr) as NodeJS.WriteStream;
    Object.defineProperty(stdoutTty, "isTTY", { value: true });
    Object.defineProperty(stderrPlain, "isTTY", { value: false });
    Object.defineProperty(stderrTty, "isTTY", { value: true });

    try {
      createCliApp({
        deps,
        env: {},
        stdout: stdoutTty,
        stderr,
        version: "0.3.2"
      }).outputHelp();
      const help = consoleLog.mock.calls.flat().join("\n");
      expect(help).toContain("sift/0.3.2");
      expect(help).toContain("Trim the noise. Keep the signal.");

      handleCliError(
        new Error("boom"),
        stderrPlain
      );
      expect(streams.stderr).toContain("boom");

      handleCliError(
        new Error("tty boom"),
        stderrTty
      );
      expect(streams.stderr).toContain("tty boom");
    } finally {
      consoleLog.mockRestore();
      streams.restore();
    }
  });

  it("runs preset pipe mode and applies fail-on gating", async () => {
    const deps = createDeps();
    const streams = captureStreams();

    try {
      await runMatched(["preset", "infra-risk", "--fail-on"], deps);
      expect(deps.resolveConfig).toHaveBeenCalled();
      expect(deps.getPreset).toHaveBeenCalledWith(defaultConfig, "infra-risk");
      expect(deps.readStdin).toHaveBeenCalled();
      expect(deps.runSift).toHaveBeenCalled();
      expect(deps.assertSupportedFailOnPreset).toHaveBeenCalledWith("infra-risk");
      expect(process.exitCode).toBe(1);
      expect(streams.stdout).toContain("Reduced answer");
    } finally {
      streams.restore();
    }
  });

  it("prints raw stdin to stderr in pipe mode and appends a newline when needed", async () => {
    const deps = createDeps({
      readStdin: vi.fn().mockResolvedValue("raw stdin without newline")
    });
    const streams = captureStreams();

    try {
      await runMatched(["what changed?", "--show-raw"], deps);
      expect(streams.stderr).toBe("raw stdin without newline\n");
      expect(streams.stdout).toContain("Reduced answer");
    } finally {
      streams.restore();
    }
  });

  it("drops preset policy when the output format is explicitly overridden", async () => {
    const deps = createDeps();

    await runMatched(["preset", "test-status", "--format", "json"], deps);

    expect(deps.runSift).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "json",
        presetName: "test-status",
        policyName: undefined
      })
    );
  });

  it("covers exec mode branches for freeform, preset, and validation errors", async () => {
    const deps = createDeps();

    await runMatched(["exec", "what changed?", "--", "git", "diff"], deps);
    expect(deps.runExec).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "what changed?",
        format: "brief",
        command: ["git", "diff"]
      })
    );

    await runMatched(["exec", "--preset", "test-status", "--", "pytest"], deps);
    expect(deps.getPreset).toHaveBeenCalledWith(defaultConfig, "test-status");
    expect(deps.runExec).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presetName: "test-status",
        policyName: "test-status"
      })
    );

    await runMatched(
      ["exec", "--preset", "test-status", "--format", "brief", "--", "pytest"],
      deps
    );
    expect(deps.runExec).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presetName: "test-status",
        policyName: undefined,
        format: "brief"
      })
    );

    await runMatched(
      ["exec", "--preset", "test-status", "--detail", "focused", "--", "pytest"],
      deps
    );
    expect(deps.runExec).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presetName: "test-status",
        detail: "focused"
      })
    );

    await runMatched(
      ["exec", "--preset", "test-status", "--detail", "verbose", "--", "pytest"],
      deps
    );
    expect(deps.runExec).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presetName: "test-status",
        detail: "verbose"
      })
    );

    await runMatched(["exec", "--preset", "test-status", "--diff", "--", "pytest"], deps);
    expect(deps.runExec).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presetName: "test-status",
        diff: true
      })
    );

    await runMatched(
      ["exec", "--preset", "infra-risk", "--fail-on", "--", "terraform", "plan"],
      deps
    );
    expect(deps.assertSupportedFailOnPreset).toHaveBeenCalledWith("infra-risk");
    expect(deps.assertSupportedFailOnFormat).toHaveBeenCalledWith({
      presetName: "infra-risk",
      format: "verdict"
    });

    await expect(runMatched(["exec", "preset"], deps)).rejects.toThrow(
      "Use 'sift exec --preset <name> -- <program> ...' instead."
    );
    await expect(
      runMatched(["exec", "question", "--preset", "test-status", "--", "pytest"], deps)
    ).rejects.toThrow("Use either a freeform question or --preset <name>, not both.");
    await expect(
      runMatched(["exec", "--preset", "test-status", "--detail", "nope", "--", "pytest"], deps)
    ).rejects.toThrow("Invalid --detail value. Use standard, focused, or verbose.");
    await expect(
      runMatched(["exec", "--preset", "infra-risk", "--diff", "--", "terraform", "plan"], deps)
    ).rejects.toThrow("--diff is supported only with --preset test-status.");
    await expect(runMatched(["exec"], deps)).rejects.toThrow("Missing question or preset.");
  });

  it("covers config, doctor, presets, and freeform command actions", async () => {
    const deps = createDeps();

    await runMatched(["config", "setup"], deps);
    expect(deps.configSetup).toHaveBeenCalled();

    await runMatched(["agent", "show", "codex"], deps);
    expect(deps.showAgent).toHaveBeenCalledWith({
      agent: "codex",
      scope: undefined,
      targetPath: undefined,
      raw: false
    });

    await runMatched(["agent", "show", "codex", "--raw"], deps);
    expect(deps.showAgent).toHaveBeenLastCalledWith({
      agent: "codex",
      scope: undefined,
      targetPath: undefined,
      raw: true
    });

    await runMatched(["agent", "install", "claude", "--scope", "global", "--yes"], deps);
    expect(deps.installAgent).toHaveBeenCalledWith({
      agent: "claude",
      scope: "global",
      targetPath: undefined,
      dryRun: false,
      raw: false,
      yes: true
    });

    await runMatched(["agent", "install", "codex", "--dry-run", "--raw", "--yes"], deps);
    expect(deps.installAgent).toHaveBeenLastCalledWith({
      agent: "codex",
      scope: undefined,
      targetPath: undefined,
      dryRun: true,
      raw: true,
      yes: true
    });

    await runMatched(["agent", "remove", "codex", "--path", "/tmp/AGENTS.md", "--yes"], deps);
    expect(deps.removeAgent).toHaveBeenCalledWith({
      agent: "codex",
      scope: undefined,
      targetPath: "/tmp/AGENTS.md",
      dryRun: false,
      yes: true
    });

    await runMatched(["agent", "status"], deps);
    expect(deps.statusAgents).toHaveBeenCalled();

    await runMatched(["escalate", "--detail", "verbose", "--show-raw"], deps);
    expect(deps.runEscalate).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Did the tests pass?",
        format: "bullets",
        goal: "summarize",
        policyName: "test-status",
        detail: "verbose",
        showRaw: true,
        verbose: false
      })
    );

    await runMatched(["rerun"], deps);
    expect(deps.runRerun).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Did the tests pass?",
        format: "bullets",
        remaining: false,
        detail: "standard",
        showRaw: false,
        policyName: "test-status"
      })
    );

    await runMatched(["rerun", "--remaining", "--detail", "verbose", "--show-raw"], deps);
    expect(deps.runRerun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        remaining: true,
        detail: "verbose",
        showRaw: true
      })
    );

    await expect(runMatched(["escalate", "--detail", "standard"], deps)).rejects.toThrow(
      "Invalid --detail value. Use focused or verbose."
    );
    await expect(runMatched(["rerun", "--show-raw"], deps)).rejects.toThrow(
      "--show-raw is supported only with `sift rerun --remaining`."
    );
    await expect(runMatched(["rerun", "--detail", "focused"], deps)).rejects.toThrow(
      "--detail is supported only with `sift rerun --remaining`."
    );

    await runMatched(["config", "init", "--global"], deps);
    expect(deps.configInit).toHaveBeenCalledWith(undefined, true);

    await runMatched(["config", "show", "--show-secrets"], deps);
    expect(deps.configShow).toHaveBeenCalledWith(undefined, true);

    await runMatched(["config", "use", "openrouter"], deps);
    expect(deps.configUse).toHaveBeenCalledWith("openrouter", undefined, {});

    await runMatched(["config", "validate"], deps);
    expect(deps.configValidate).toHaveBeenCalledWith(undefined);

    await expect(runMatched(["config", "mystery"], deps)).rejects.toThrow(
      "Unknown config action: mystery"
    );
    await expect(runMatched(["config", "use"], deps)).rejects.toThrow("Missing provider name.");
    await expect(runMatched(["agent", "show"], deps)).rejects.toThrow("Missing agent name.");
    await expect(runMatched(["agent", "install"], deps)).rejects.toThrow("Missing agent name.");
    await expect(runMatched(["agent", "remove"], deps)).rejects.toThrow("Missing agent name.");
    await expect(runMatched(["agent", "mystery"], deps)).rejects.toThrow(
      "Unknown agent action: mystery"
    );

    await runMatched(["doctor"], deps);
    expect(deps.findConfigPath).toHaveBeenCalledWith(undefined);
    expect(deps.runDoctor).toHaveBeenCalled();

    await runMatched(["presets", "list"], deps);
    expect(deps.listPresets).toHaveBeenCalled();

    await runMatched(["presets", "show", "infra-risk", "--internal"], deps);
    expect(deps.showPreset).toHaveBeenCalledWith(defaultConfig, "infra-risk", true);

    await runMatched(["preset", "infra-risk", "--format", "verdict"], deps);
    expect(deps.runSift).toHaveBeenCalledWith(
      expect.objectContaining({
        policyName: "infra-risk",
        format: "verdict"
      })
    );

    await expect(runMatched(["presets", "show"], deps)).rejects.toThrow("Missing preset name.");
    await expect(runMatched(["presets", "mystery"], deps)).rejects.toThrow(
      "Unknown presets action: mystery"
    );

    await runMatched(["what changed?"], deps);
    expect(deps.runSift).toHaveBeenCalled();

    await expect(runMatched([], deps)).rejects.toThrow("Missing question.");
  });

  it("runs the top-level runCli helper", async () => {
    const deps = createDeps();
    await runCli({
      argv: ["node", "sift", "presets", "list"],
      deps,
      env: {}
    });

    expect(deps.listPresets).toHaveBeenCalledWith(defaultConfig);
  });

  it("covers default process fallbacks in createCliApp and runCli", async () => {
    const deps = createDeps();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalArgv = process.argv;

    try {
      createCliApp({ deps }).outputHelp();
      expect(consoleLog).toHaveBeenCalled();

      process.argv = ["node", "sift", "presets", "list"];
      await runCli({ deps });
      expect(deps.listPresets).toHaveBeenCalledWith(defaultConfig);
    } finally {
      process.argv = originalArgv;
      consoleLog.mockRestore();
    }
  });

  it("handles non-Error cli failures with a generic message", () => {
    const streams = captureStreams();
    const stderr = process.stderr as NodeJS.WriteStream;
    const plainStderr = Object.create(stderr, {
      isTTY: {
        configurable: true,
        value: false
      }
    }) as NodeJS.WriteStream;

    try {
      handleCliError("boom", plainStderr);
      expect(streams.stderr).toContain("Unexpected error.");
    } finally {
      streams.restore();
    }
  });
});
