import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import {
  buildCliOverrides,
  cleanHelpSectionBody,
  createCliApp,
  extractExecCommand,
  handleCliError,
  runCli,
  toNumber,
  type CliDeps
} from "../src/cli-app.js";

function createDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    configInit: vi.fn(),
    configSetup: vi.fn().mockResolvedValue(0),
    configShow: vi.fn(),
    configValidate: vi.fn(),
    runDoctor: vi.fn().mockReturnValue(0),
    listPresets: vi.fn(),
    showPreset: vi.fn(),
    resolveConfig: vi.fn().mockReturnValue(defaultConfig),
    findConfigPath: vi.fn().mockReturnValue("/tmp/sift.config.yaml"),
    runExec: vi.fn().mockResolvedValue(0),
    assertSupportedFailOnFormat: vi.fn(),
    assertSupportedFailOnPreset: vi.fn(),
    evaluateGate: vi.fn().mockReturnValue({ shouldFail: true }),
    readStdin: vi.fn().mockResolvedValue("stdin"),
    runSift: vi.fn().mockResolvedValue("Reduced answer"),
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
    version: "0.2.3"
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

  it("cleans duplicate version text only for string help sections", () => {
    expect(cleanHelpSectionBody("sift/0.2.3\n\nUsage:\n", "0\\.2\\.3")).toBe(
      "\nUsage:\n"
    );
    expect(cleanHelpSectionBody("Usage:\n", "0\\.2\\.3")).toBe("Usage:\n");
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

  it("handles help output and tty/non-tty errors", async () => {
    const deps = createDeps();
    const streams = captureStreams();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdout = process.stdout as NodeJS.WriteStream;
    const stderr = process.stderr as NodeJS.WriteStream;

    try {
      createCliApp({
        deps,
        env: {},
        stdout: Object.assign(Object.create(stdout), { isTTY: true }) as NodeJS.WriteStream,
        stderr,
        version: "0.2.3"
      }).outputHelp();
      const help = consoleLog.mock.calls.flat().join("\n");
      expect(help).toContain("sift/0.2.3");
      expect(help).toContain("Trim the noise. Keep the signal.");

      handleCliError(
        new Error("boom"),
        Object.assign(Object.create(stderr), { isTTY: false }) as NodeJS.WriteStream
      );
      expect(streams.stderr).toContain("boom");

      handleCliError(
        new Error("tty boom"),
        Object.assign(Object.create(stderr), { isTTY: true }) as NodeJS.WriteStream
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
    await expect(runMatched(["exec"], deps)).rejects.toThrow("Missing question or preset.");
  });

  it("covers config, doctor, presets, and freeform command actions", async () => {
    const deps = createDeps();

    await runMatched(["config", "setup"], deps);
    expect(deps.configSetup).toHaveBeenCalled();

    await runMatched(["config", "init", "--global"], deps);
    expect(deps.configInit).toHaveBeenCalledWith(undefined, true);

    await runMatched(["config", "show", "--show-secrets"], deps);
    expect(deps.configShow).toHaveBeenCalledWith(undefined, true);

    await runMatched(["config", "validate"], deps);
    expect(deps.configValidate).toHaveBeenCalledWith(undefined);

    await expect(runMatched(["config", "mystery"], deps)).rejects.toThrow(
      "Unknown config action: mystery"
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
