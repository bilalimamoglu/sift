import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import pc from "picocolors";
import { CAPTURE_OMITTED_MARKER } from "../constants.js";
import type { OutputFormat, RunRequest, SiftConfig } from "../types.js";
import { evaluateGate, supportsFailOnPreset } from "./gate.js";
import { analyzeTestStatus, detectTestRunner } from "./heuristics.js";
import {
  buildInsufficientSignalOutput,
  isInsufficientSignalOutput
} from "./insufficient.js";
import { runSiftWithStats } from "./run.js";
import { emitStatsFooter, type RunStats } from "./stats.js";
import { looksLikeWatchStream, runWatch } from "./watch.js";
import {
  buildTestStatusCommandKey,
  createCachedTestStatusRun,
  diffTestStatusRuns,
  diffTestStatusTargets,
  isRemainingSubsetAvailable,
  tryReadCachedTestStatusRun,
  writeCachedTestStatusRun
} from "./testStatusState.js";

const PROMPT_PATTERNS = [
  /\[[^\]]*y\/n[^\]]*\]\s*$/i,
  /\([^)]+y\/n[^)]*\)\s*$/i,
  /continue\?\s*$/i,
  /password:\s*$/i,
  /passphrase:\s*$/i,
  /otp:\s*$/i,
  /enter choice:\s*$/i
];

const PROMPT_WINDOW_CHARS = 512;

export class BoundedCapture {
  private readonly headBudget: number;
  private readonly tailBudget: number;
  private readonly maxChars: number;
  private full = "";
  private head = "";
  private tail = "";
  private overflowed = false;
  private totalChars = 0;

  constructor(maxChars: number) {
    this.maxChars = maxChars;
    this.headBudget = Math.max(1, Math.floor(maxChars / 2));
    this.tailBudget = Math.max(1, maxChars - this.headBudget);
  }

  push(chunk: string): void {
    this.totalChars += chunk.length;

    if (!this.overflowed) {
      this.full += chunk;

      if (this.full.length <= this.maxChars) {
        return;
      }

      this.overflowed = true;
      this.head = this.full.slice(0, this.headBudget);
      this.tail = this.full.slice(-this.tailBudget);
      this.full = "";
      return;
    }

    this.tail = `${this.tail}${chunk}`.slice(-this.tailBudget);
  }

  render(): string {
    if (!this.overflowed) {
      return this.full;
    }

    return `${this.head}${CAPTURE_OMITTED_MARKER}${this.tail}`;
  }

  getTotalChars(): number {
    return this.totalChars;
  }

  wasTruncated(): boolean {
    return this.overflowed;
  }
}

export function looksInteractivePrompt(windowText: string): boolean {
  return PROMPT_PATTERNS.some((pattern) => pattern.test(windowText));
}

function signalToExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) {
    return 1;
  }

  const signalNumber = osConstants.signals[signal];
  if (typeof signalNumber !== "number") {
    return 1;
  }

  return 128 + signalNumber;
}

export function normalizeChildExitCode(
  status: number | null,
  signal: NodeJS.Signals | null
): number {
  if (typeof status === "number") {
    return status;
  }

  return signalToExitCode(signal);
}

export interface ExecRequest extends Omit<RunRequest, "stdin"> {
  command?: string[];
  cwd?: string;
  diff?: boolean;
  failOn?: boolean;
  quiet?: boolean;
  showRaw?: boolean;
  shellCommand?: string;
  skipCacheWrite?: boolean;
  readCachedBaseline?: boolean;
  writeCachedBaseline?: boolean;
  watch?: boolean;
}

export function buildCommandPreview(request: ExecRequest): string {
  if (request.shellCommand) {
    return request.shellCommand;
  }

  return (request.command ?? []).join(" ");
}

export function getExecSuccessShortcut(args: {
  presetName?: string;
  exitCode: number;
  capturedOutput: string;
}): string | null {
  if (args.exitCode !== 0) {
    return null;
  }

  if (args.presetName === "typecheck-summary" && args.capturedOutput.trim() === "") {
    return "No type errors.";
  }

  return null;
}

export async function runExec(request: ExecRequest): Promise<number> {
  const hasArgvCommand = Array.isArray(request.command) && request.command.length > 0;
  const hasShellCommand = typeof request.shellCommand === "string";

  if (hasArgvCommand === hasShellCommand) {
    throw new Error("Provide either --shell <command> or -- <program> [args...].");
  }

  const shellPath = process.env.SHELL || "/bin/bash";
  const commandPreview = buildCommandPreview(request);
  const commandCwd = request.cwd ?? process.cwd();
  const isTestStatusPreset = request.presetName === "test-status";
  const readCachedBaseline = isTestStatusPreset && (request.readCachedBaseline ?? true);
  const writeCachedBaselineRequested =
    isTestStatusPreset &&
    (request.writeCachedBaseline ?? (request.skipCacheWrite ? false : true));
  const previousCachedRun = readCachedBaseline ? tryReadCachedTestStatusRun() : null;
  if (request.config.runtime.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} exec mode=${hasShellCommand ? "shell" : "argv"} command=${commandPreview}\n`
    );
  }

  const capture = new BoundedCapture(request.config.input.maxCaptureChars);
  let promptWindow = "";
  let bypassed = false;
  let childStatus: number | null = null;
  let childSignal: NodeJS.Signals | null = null;

  const child = hasShellCommand
    ? spawn(shellPath, ["-lc", request.shellCommand as string], {
        cwd: commandCwd,
        stdio: ["inherit", "pipe", "pipe"] as const
      })
    : spawn((request.command as string[])[0]!, (request.command as string[]).slice(1), {
        cwd: commandCwd,
        stdio: ["inherit", "pipe", "pipe"] as const
      });

  const handleChunk = (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);

    if (bypassed) {
      process.stderr.write(text);
      return;
    }

    capture.push(text);
    promptWindow = `${promptWindow}${text}`.slice(-PROMPT_WINDOW_CHARS);

    if (!looksInteractivePrompt(promptWindow)) {
      return;
    }

    bypassed = true;

    if (request.config.runtime.verbose) {
      process.stderr.write(`${pc.dim("sift")} bypass=interactive-prompt\n`);
    }

    // Interactive prompts need the raw terminal text, not a distilled answer.
    // Once we detect one, we switch to passthrough on stderr and skip reduction.
    process.stderr.write(capture.render());
  };

  child.stdout.on("data", handleChunk);
  child.stderr.on("data", handleChunk);

  await new Promise<void>((resolve, reject) => {
    child.on("error", (error: Error) => {
      reject(error);
    });
    child.on("close", (status: number | null, signal: NodeJS.Signals | null) => {
      childStatus = status;
      childSignal = signal;
      resolve();
    });
  }).catch((error) => {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Failed to start child process.");
  });

  const exitCode = normalizeChildExitCode(childStatus, childSignal);
  const capturedOutput = capture.render();
  const autoWatchDetected = !request.watch && looksLikeWatchStream(capturedOutput);
  const useWatchFlow = Boolean(request.watch) || autoWatchDetected;
  const shouldBuildTestStatusState = isTestStatusPreset && !useWatchFlow;
  const shouldWriteCachedBaseline = writeCachedBaselineRequested && !useWatchFlow;

  if (request.config.runtime.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} child_exit=${exitCode} captured_chars=${capture.getTotalChars()} capture_truncated=${capture.wasTruncated()}\n`
    );
  }

  if (autoWatchDetected) {
    process.stderr.write(`${pc.dim("sift")} auto-watch=detected\n`);
  }

  if (!bypassed) {
    const reductionStartedAt = Date.now();

    if (request.showRaw && capturedOutput.length > 0) {
      process.stderr.write(capturedOutput);
      if (!capturedOutput.endsWith("\n")) {
        process.stderr.write("\n");
      }
    }

    const execSuccessShortcut = useWatchFlow
      ? null
      : getExecSuccessShortcut({
          presetName: request.presetName,
          exitCode,
          capturedOutput
        });

    if (execSuccessShortcut && !request.dryRun) {
      if (request.config.runtime.verbose) {
        process.stderr.write(
          `${pc.dim("sift")} exec_shortcut=${request.presetName}\n`
        );
      }

      process.stdout.write(`${execSuccessShortcut}\n`);
      emitStatsFooter({
        stats: {
          layer: "heuristic",
          providerCalled: false,
          totalTokens: null,
          durationMs: Date.now() - reductionStartedAt,
          presetName: request.presetName
        } satisfies RunStats,
        quiet: Boolean(request.quiet)
      });
      return exitCode;
    }

    if (useWatchFlow) {
      let output = await runWatch({
        ...request,
        stdin: capturedOutput
      });

      if (isInsufficientSignalOutput(output)) {
        output = buildInsufficientSignalOutput({
          presetName: request.presetName,
          originalLength: capture.getTotalChars(),
          truncatedApplied: capture.wasTruncated(),
          exitCode,
          recognizedRunner: detectTestRunner(capturedOutput)
        });
      }

      process.stdout.write(`${output}\n`);
      return exitCode;
    }

    const analysis = shouldBuildTestStatusState ? analyzeTestStatus(capturedOutput) : null;
    let currentCachedRun =
      shouldBuildTestStatusState && analysis
        ? createCachedTestStatusRun({
            cwd: commandCwd,
            commandKey: buildTestStatusCommandKey({
              cwd: commandCwd,
              runner: analysis.runner,
              command:
                Array.isArray(request.command) && request.command.length > 0
                  ? {
                      mode: "argv",
                      argv: [...request.command]
                    }
                  : request.shellCommand
                    ? {
                        mode: "shell",
                        shellCommand: request.shellCommand
                      }
                    : undefined,
              commandPreview,
              shellCommand: request.shellCommand
            }),
            commandPreview,
            command: request.command,
            shellCommand: request.shellCommand,
            detail: request.detail ?? "standard",
            exitCode,
            rawOutput: capturedOutput,
            originalChars: capture.getTotalChars(),
            truncatedApplied: capture.wasTruncated(),
            analysis
          })
        : null;
    const targetDelta =
      (request.diff || request.testStatusContext?.remainingMode === "subset_rerun" || request.testStatusContext?.remainingMode === "full_rerun_diff") &&
      !request.dryRun &&
      previousCachedRun &&
      currentCachedRun
        ? diffTestStatusTargets({
            previous: previousCachedRun,
            current: currentCachedRun
          })
        : null;

    const result = await runSiftWithStats({
      ...request,
      stdin: capturedOutput,
      analysisContext:
        request.testStatusContext?.remainingMode &&
        request.testStatusContext.remainingMode !== "none" &&
        request.presetName === "test-status"
          ? [
              request.analysisContext,
              "Zoom context:",
              "- This pass is remaining-only.",
              "- The full-suite truth already exists from the cached full run.",
              "- Do not reintroduce resolved tests into the diagnosis."
            ]
              .filter((value): value is string => Boolean(value))
              .join("\n")
          : request.analysisContext,
      testStatusContext:
        shouldBuildTestStatusState && analysis
          ? {
              ...request.testStatusContext,
              resolvedTests: targetDelta?.resolved ?? request.testStatusContext?.resolvedTests,
              remainingTests:
                targetDelta?.remaining ??
                currentCachedRun?.runner.failingTargets ??
                request.testStatusContext?.remainingTests,
              remainingSubsetAvailable:
                request.testStatusContext?.remainingSubsetAvailable ??
                Boolean(
                  currentCachedRun &&
                    isRemainingSubsetAvailable(currentCachedRun) &&
                    (
                      targetDelta?.remaining ??
                      currentCachedRun?.runner.failingTargets ??
                      []
                    ).length > 0
                ),
              remainingMode: request.testStatusContext?.remainingMode ?? "none"
            }
          : request.testStatusContext
    });
    let output = result.output;

    if (shouldBuildTestStatusState) {
      if (isInsufficientSignalOutput(output)) {
        output = buildInsufficientSignalOutput({
          presetName: request.presetName,
          originalLength: capture.getTotalChars(),
          truncatedApplied: capture.wasTruncated(),
          exitCode,
          recognizedRunner: detectTestRunner(capturedOutput)
        });
      }

      if (request.diff && !request.dryRun && previousCachedRun && currentCachedRun) {
        const delta = diffTestStatusRuns({
          previous: previousCachedRun,
          current: currentCachedRun
        });
        if (delta.lines.length > 0) {
          output = `${delta.lines.join("\n")}\n${output}`;
        }
      }

      if (currentCachedRun && shouldWriteCachedBaseline) {
        try {
          writeCachedTestStatusRun(currentCachedRun);
        } catch (error) {
          if (request.config.runtime.verbose) {
            const reason = error instanceof Error ? error.message : "unknown_error";
            process.stderr.write(`${pc.dim("sift")} cache_write=failed reason=${reason}\n`);
          }
        }
      }
    } else if (isInsufficientSignalOutput(output)) {
      output = buildInsufficientSignalOutput({
        presetName: request.presetName,
        originalLength: capture.getTotalChars(),
        truncatedApplied: capture.wasTruncated(),
        exitCode,
        recognizedRunner: detectTestRunner(capturedOutput)
      });
    }

    process.stdout.write(`${output}\n`);
    emitStatsFooter({
      stats: result.stats,
      quiet: Boolean(request.quiet)
    });

    if (
      request.failOn &&
      !request.dryRun &&
      exitCode === 0 &&
      supportsFailOnPreset(request.presetName) &&
      evaluateGate({
        presetName: request.presetName,
        output
      }).shouldFail
    ) {
      return 1;
    }
  }

  return exitCode;
}
