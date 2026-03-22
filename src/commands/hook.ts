import { spawn } from "node:child_process";
import { stderr as defaultStderr } from "node:process";
import pc from "picocolors";
import { createPresentation } from "../ui/presentation.js";
import { runExec, type ExecRequest, normalizeChildExitCode } from "../core/exec.js";
import { recordHistoryEvent } from "../core/history.js";
import {
  matchKnownCommand,
  type KnownCommandMatchArgs,
  type KnownCommandMatchResult
} from "../core/known-command-match.js";
import type { DetailLevel, SiftConfig } from "../types.js";

export interface HookMatchArgs extends KnownCommandMatchArgs {}

export interface HookMatchResult extends KnownCommandMatchResult {}

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

export function matchHookCommand(args: HookMatchArgs): HookMatchResult {
  return matchKnownCommand(args);
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
    if (!args.dryRun && args.config.history.enabled) {
      try {
        await recordHistoryEvent({
          cwd: args.cwd ?? process.cwd(),
          entrypoint: "hook",
          operationMode: args.config.runtime.operationMode,
          commandFamily: match.commandFamily,
          presetName: null,
          candidatePresetName: null,
          providerCalled: false,
          layer: "none",
          detail: args.detail ?? null,
          resultKind: "pass-through",
          inputChars: 0,
          outputChars: 0,
          historyConfig: args.config.history,
          homeDir: process.env.HOME
        });
      } catch (error) {
        if (args.config.runtime.verbose) {
          const reason = error instanceof Error ? error.message : "unknown_error";
          process.stderr.write(`${pc.dim("sift")} history_write=failed reason=${reason}\n`);
        }
      }
    }
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
      quiet: args.quiet,
      historyEntrypoint: "hook"
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
