import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import pc from "picocolors";
import { CAPTURE_OMITTED_MARKER } from "../constants.js";
import type { OutputFormat, RunRequest, SiftConfig } from "../types.js";
import { runSift } from "./run.js";

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

class BoundedCapture {
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

function looksInteractivePrompt(windowText: string): boolean {
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

function normalizeChildExitCode(status: number | null, signal: NodeJS.Signals | null): number {
  if (typeof status === "number") {
    return status;
  }

  return signalToExitCode(signal);
}

export interface ExecRequest extends Omit<RunRequest, "stdin"> {
  command?: string[];
  shellCommand?: string;
}

function buildCommandPreview(request: ExecRequest): string {
  if (request.shellCommand) {
    return request.shellCommand;
  }

  return (request.command ?? []).join(" ");
}

export async function runExec(request: ExecRequest): Promise<number> {
  const hasArgvCommand = Array.isArray(request.command) && request.command.length > 0;
  const hasShellCommand = typeof request.shellCommand === "string";

  if (hasArgvCommand === hasShellCommand) {
    throw new Error("Provide either --shell <command> or -- <program> [args...].");
  }

  const shellPath = process.env.SHELL || "/bin/bash";
  if (request.config.runtime.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} exec mode=${hasShellCommand ? "shell" : "argv"} command=${buildCommandPreview(request)}\n`
    );
  }

  const capture = new BoundedCapture(request.config.input.maxCaptureChars);
  let promptWindow = "";
  let bypassed = false;
  let childStatus: number | null = null;
  let childSignal: NodeJS.Signals | null = null;
  let childSpawnError: Error | null = null;

  const child = hasShellCommand
    ? spawn(shellPath, ["-lc", request.shellCommand as string], {
        stdio: ["inherit", "pipe", "pipe"] as const
      })
    : spawn((request.command as string[])[0]!, (request.command as string[]).slice(1), {
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
      childSpawnError = error;
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

  if (childSpawnError) {
    throw childSpawnError;
  }

  const exitCode = normalizeChildExitCode(childStatus, childSignal);

  if (request.config.runtime.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} child_exit=${exitCode} captured_chars=${capture.getTotalChars()} capture_truncated=${capture.wasTruncated()}\n`
    );
  }

  if (!bypassed) {
    const output = await runSift({
      ...request,
      stdin: capture.render()
    });

    process.stdout.write(`${output}\n`);
  }

  return exitCode;
}
