import { spawn } from "node:child_process";
import { stderr as defaultStderr } from "node:process";
import { createPresentation } from "../ui/presentation.js";
import { runExec, type ExecRequest, normalizeChildExitCode } from "../core/exec.js";
import type { DetailLevel, SiftConfig } from "../types.js";

export interface HookMatchArgs {
  command?: string[];
  shellCommand?: string;
}

export interface HookMatchResult {
  matched: boolean;
  presetName?: string;
  reason: string;
}

export interface HookRunArgs extends HookMatchArgs {
  config: SiftConfig;
  cwd?: string;
  dryRun?: boolean;
  showRaw?: boolean;
  includeTestIds?: boolean;
  detail?: DetailLevel;
  failOn?: boolean;
  quiet?: boolean;
}

export interface HookDeps {
  runExec: (request: ExecRequest) => Promise<number>;
  runRaw: (args: HookMatchArgs & { cwd?: string }) => Promise<number>;
}

const defaultHookDeps: HookDeps = {
  runExec,
  runRaw: runRawHookCommand
};

function isBareCommandName(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return !/[\\/]/.test(value);
}

function shellStartsWith(pattern: RegExp, shellCommand: string): boolean {
  return pattern.test(shellCommand.trim());
}

function matchArgvCommand(command: string[]): HookMatchResult {
  const first = command[0];
  const second = command[1];
  const third = command[2];

  if (!first) {
    return {
      matched: false,
      reason: "Missing command."
    };
  }

  if (!isBareCommandName(first)) {
    return {
      matched: false,
      reason: "Path-prefixed binaries stay out of the beta matcher."
    };
  }

  if (first === "sift") {
    return {
      matched: false,
      reason: "sift commands are never re-hooked."
    };
  }

  if (first === "python" && second === "-m" && third === "pytest") {
    return {
      matched: true,
      presetName: "test-status",
      reason: "Matched python -m pytest -> test-status."
    };
  }

  if (first === "pytest" || first === "vitest" || first === "jest") {
    return {
      matched: true,
      presetName: "test-status",
      reason: `Matched ${first} -> test-status.`
    };
  }

  if (first === "tsc") {
    return {
      matched: true,
      presetName: "typecheck-summary",
      reason: "Matched tsc -> typecheck-summary."
    };
  }

  if (first === "eslint" || first === "biome" || first === "ruff" || first === "flake8") {
    return {
      matched: true,
      presetName: "lint-failures",
      reason: `Matched ${first} -> lint-failures.`
    };
  }

  if (
    (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") &&
    second === "audit"
  ) {
    return {
      matched: true,
      presetName: "audit-critical",
      reason: `Matched ${first} audit -> audit-critical.`
    };
  }

  if (first === "terraform" && second === "plan") {
    return {
      matched: true,
      presetName: "infra-risk",
      reason: "Matched terraform plan -> infra-risk."
    };
  }

  if (first === "git" && second === "diff") {
    return {
      matched: true,
      presetName: "diff-summary",
      reason: "Matched git diff -> diff-summary."
    };
  }

  return {
    matched: false,
    reason: "No known preset matcher for this command."
  };
}

function matchShellCommand(shellCommand: string): HookMatchResult {
  const trimmed = shellCommand.trim();

  if (trimmed.length === 0) {
    return {
      matched: false,
      reason: "Missing shell command."
    };
  }

  if (shellStartsWith(/^sift(?:\s|$)/, trimmed)) {
    return {
      matched: false,
      reason: "sift commands are never re-hooked."
    };
  }

  if (shellStartsWith(/^python\s+-m\s+pytest(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "test-status",
      reason: "Matched python -m pytest -> test-status."
    };
  }

  if (shellStartsWith(/^(pytest|vitest|jest)(?:\s|$)/, trimmed)) {
    const tool = trimmed.split(/\s+/, 1)[0]!;
    return {
      matched: true,
      presetName: "test-status",
      reason: `Matched ${tool} -> test-status.`
    };
  }

  if (shellStartsWith(/^tsc(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "typecheck-summary",
      reason: "Matched tsc -> typecheck-summary."
    };
  }

  if (shellStartsWith(/^(eslint|biome|ruff|flake8)(?:\s|$)/, trimmed)) {
    const tool = trimmed.split(/\s+/, 1)[0]!;
    return {
      matched: true,
      presetName: "lint-failures",
      reason: `Matched ${tool} -> lint-failures.`
    };
  }

  if (shellStartsWith(/^(npm|pnpm|yarn|bun)\s+audit(?:\s|$)/, trimmed)) {
    const tool = trimmed.split(/\s+/, 1)[0]!;
    return {
      matched: true,
      presetName: "audit-critical",
      reason: `Matched ${tool} audit -> audit-critical.`
    };
  }

  if (shellStartsWith(/^terraform\s+plan(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "infra-risk",
      reason: "Matched terraform plan -> infra-risk."
    };
  }

  if (shellStartsWith(/^git\s+diff(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "diff-summary",
      reason: "Matched git diff -> diff-summary."
    };
  }

  return {
    matched: false,
    reason: "No known preset matcher for this command."
  };
}

export function matchHookCommand(args: HookMatchArgs): HookMatchResult {
  const hasArgvCommand = Array.isArray(args.command) && args.command.length > 0;
  const hasShellCommand =
    typeof args.shellCommand === "string" && args.shellCommand.trim().length > 0;

  if (hasArgvCommand === hasShellCommand) {
    throw new Error("Provide either --shell <command> or -- <program> [args...].");
  }

  if (hasArgvCommand) {
    return matchArgvCommand(args.command!);
  }

  return matchShellCommand(args.shellCommand!);
}

function buildCommandPreview(args: HookMatchArgs): string {
  if (args.shellCommand) {
    return args.shellCommand;
  }

  return (args.command ?? []).join(" ");
}

function emitDecision(message: string, quiet = false): void {
  if (quiet || !defaultStderr.isTTY) {
    return;
  }

  const ui = createPresentation(true);
  defaultStderr.write(`${ui.info(message)}\n`);
}

export function showHookMatch(args: HookMatchArgs): void {
  const result = matchHookCommand(args);
  const lines = [
    `command: ${buildCommandPreview(args)}`,
    `decision: ${result.matched ? "matched" : "passed-through"}`,
    `reason: ${result.reason}`
  ];

  if (result.matched) {
    lines.splice(1, 0, `preset: ${result.presetName}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

export async function runRawHookCommand(
  args: HookMatchArgs & { cwd?: string }
): Promise<number> {
  const hasArgvCommand = Array.isArray(args.command) && args.command.length > 0;
  const hasShellCommand =
    typeof args.shellCommand === "string" && args.shellCommand.trim().length > 0;

  if (hasArgvCommand === hasShellCommand) {
    throw new Error("Provide either --shell <command> or -- <program> [args...].");
  }

  const shellPath = process.env.SHELL || "/bin/bash";
  const child = hasShellCommand
    ? spawn(shellPath, ["-lc", args.shellCommand as string], {
        cwd: args.cwd ?? process.cwd(),
        stdio: "inherit"
      })
    : spawn((args.command as string[])[0]!, (args.command as string[]).slice(1), {
        cwd: args.cwd ?? process.cwd(),
        stdio: "inherit"
      });

  return await new Promise<number>((resolve, reject) => {
    child.on("error", (error: Error) => {
      reject(error);
    });
    child.on("close", (status: number | null, signal: NodeJS.Signals | null) => {
      resolve(normalizeChildExitCode(status, signal));
    });
  });
}

export async function runHook(
  args: HookRunArgs,
  deps: HookDeps = defaultHookDeps
): Promise<number> {
  const match = matchHookCommand(args);

  if (!match.matched) {
    emitDecision(`Hook beta passed through. ${match.reason}`, Boolean(args.quiet));
    if (args.dryRun) {
      process.stdout.write("No known preset match. Raw command would run unchanged.\n");
      return 0;
    }
    return await deps.runRaw({
      command: args.command,
      shellCommand: args.shellCommand,
      cwd: args.cwd
    });
  }

  const preset = args.config.presets[match.presetName!];
  if (!preset) {
    throw new Error(`Unknown preset: ${match.presetName}`);
  }

  emitDecision(
    `Hook beta matched ${match.presetName}. ${match.reason}`,
    Boolean(args.quiet)
  );

  try {
    return await deps.runExec({
      question: preset.question,
      format: preset.format,
      presetName: match.presetName,
      policyName: preset.policy,
      outputContract: preset.outputContract,
      fallbackJson: preset.fallbackJson,
      command: args.command,
      shellCommand: args.shellCommand,
      cwd: args.cwd,
      config: args.config,
      dryRun: args.dryRun,
      showRaw: args.showRaw,
      includeTestIds: args.includeTestIds,
      detail: args.detail,
      failOn: args.failOn,
      quiet: args.quiet
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown hook error";
    emitDecision(
      `Hook beta fell back to the raw command. ${message}`,
      Boolean(args.quiet)
    );
    if (args.dryRun) {
      throw error;
    }
    return await deps.runRaw({
      command: args.command,
      shellCommand: args.shellCommand,
      cwd: args.cwd
    });
  }
}
