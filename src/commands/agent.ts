import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stderr as defaultStderr, stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import {
  getDefaultGlobalConfigPath,
  getDefaultClaudeGlobalCommandsDir,
  getDefaultClaudeGlobalInstructionsPath,
  getDefaultCodexGlobalInstructionsPath
} from "../constants.js";
import {
  describeInsufficientBehavior,
  describeOperationMode,
  getOperationModeLabel
} from "../config/operation-mode.js";
import {
  getDefaultExecPathLine,
  getExecVsHookDecisionLine,
  getHookBetaLine,
  getHookBetaPlainEnglishLine
} from "../content/adoption.js";
import { resolveConfig, resolveEffectiveOperationMode } from "../config/resolve.js";
import type { OperationMode } from "../types.js";
import {
  CLAUDE_COMMAND_NAMES,
  type ClaudeCommandName,
  getClaudeCommandMarker,
  renderClaudeCommandPack
} from "../runtime-payloads/claude-commands.js";
import { renderCodexSkill } from "../runtime-payloads/codex-skill.js";
import {
  describeSkillStatus,
  inspectSkillOwnership,
  resolveSkillTargetPath
} from "./skill.js";
import { renderManagedInstructionBody } from "../runtime-payloads/managed-block.js";
import { createPresentation } from "../ui/presentation.js";

export type AgentName = "codex" | "claude";
export type AgentScope = "repo" | "global";
export type AgentPlanAction = "create" | "append" | "update";

const AGENT_FILENAMES: Record<AgentName, string> = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md"
};

const AGENT_TITLES: Record<AgentName, string> = {
  codex: "Codex",
  claude: "Claude"
};

export interface AgentCommandIO {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  ask(prompt: string): Promise<string>;
  write(message: string): void;
  error(message: string): void;
  close?(): void;
}

export interface ResolveAgentTargetPathArgs {
  agent: AgentName;
  scope?: AgentScope;
  targetPath?: string;
  cwd?: string;
  homeDir?: string;
}

export interface ManagedBlockInfo {
  readonly startMarker: string;
  readonly endMarker: string;
  readonly beginMatches: number;
  readonly endMatches: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly found: boolean;
  readonly ambiguous: boolean;
}

export interface AgentInstallPlan {
  readonly action: AgentPlanAction;
  readonly targetPath: string;
  readonly block: string;
  readonly content: string;
}

export interface AgentStatusRow {
  readonly agent: AgentName;
  readonly scope: AgentScope;
  readonly targetPath: string;
  readonly fileExists: boolean;
  readonly installed: boolean;
}

interface ClaudeCommandFilePlan {
  readonly name: `${ClaudeCommandName}.md`;
  readonly targetPath: string;
  readonly content: string;
  readonly ownership: "managed" | "missing" | "custom";
  readonly action: "create" | "update" | "conflict";
}

interface ClaudeCommandPackPlan {
  readonly targetDir: string;
  readonly files: ClaudeCommandFilePlan[];
  readonly action: "create" | "update";
  readonly hasConflict: boolean;
}

export interface AgentShowArgs extends ResolveAgentTargetPathArgs {
  operationMode?: OperationMode;
  raw?: boolean;
  io?: Pick<AgentCommandIO, "write" | "stdoutIsTTY">;
}

export interface AgentInstallArgs extends ResolveAgentTargetPathArgs {
  operationMode?: OperationMode;
  dryRun?: boolean;
  raw?: boolean;
  yes?: boolean;
  io?: AgentCommandIO;
}

export interface AgentRemoveArgs extends ResolveAgentTargetPathArgs {
  dryRun?: boolean;
  yes?: boolean;
  io?: AgentCommandIO;
}

function createStdoutOnlyIO(): Pick<AgentCommandIO, "write" | "stdoutIsTTY"> {
  return {
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    write(message: string) {
      process.stdout.write(message);
    }
  };
}

export function createAgentTerminalIO(): AgentCommandIO {
  let rl: ReturnType<typeof createInterface> | undefined;

  function getInterface() {
    if (!rl) {
      rl = createInterface({
        input: defaultStdin,
        output: defaultStdout,
        terminal: true
      });
    }

    return rl;
  }

  return {
    stdinIsTTY: Boolean(defaultStdin.isTTY),
    stdoutIsTTY: Boolean(defaultStdout.isTTY),
    ask(prompt: string) {
      return getInterface().question(prompt);
    },
    write(message: string) {
      defaultStdout.write(message);
    },
    error(message: string) {
      defaultStderr.write(message);
    },
    close() {
      rl?.close();
    }
  };
}

export function normalizeAgentName(value: string): AgentName {
  if (value === "codex" || value === "claude") {
    return value;
  }

  throw new Error(`Unknown agent: ${value}`);
}

export function normalizeAgentScope(value: unknown): AgentScope | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "repo" || value === "global") {
    return value;
  }

  throw new Error("Invalid --scope value. Use repo or global.");
}

export function resolveAgentTargetPath(args: ResolveAgentTargetPathArgs): string {
  if (args.targetPath) {
    return path.resolve(args.cwd ?? process.cwd(), args.targetPath);
  }

  const scope = args.scope ?? "repo";

  if (scope === "global") {
    const homeDir = args.homeDir ?? os.homedir();
    return args.agent === "codex"
      ? getDefaultCodexGlobalInstructionsPath(homeDir)
      : getDefaultClaudeGlobalInstructionsPath(homeDir);
  }

  return path.resolve(args.cwd ?? process.cwd(), AGENT_FILENAMES[args.agent]);
}

export function resolveClaudeCommandPackTargetDir(args: {
  scope?: AgentScope;
  cwd?: string;
  homeDir?: string;
}): string {
  const scope = args.scope ?? "repo";

  if (scope === "global") {
    return getDefaultClaudeGlobalCommandsDir(args.homeDir ?? os.homedir());
  }

  return path.resolve(args.cwd ?? process.cwd(), ".claude", "commands", "sift");
}

export function getManagedBlockMarkers(agent: AgentName): {
  readonly start: string;
  readonly end: string;
} {
  return {
    start: `<!-- sift:begin ${agent} -->`,
    end: `<!-- sift:end ${agent} -->`
  };
}

function inferOperationMode(args: {
  cwd?: string;
  homeDir?: string;
  operationMode?: OperationMode;
}): OperationMode {
  if (args.operationMode) {
    return args.operationMode;
  }

  try {
    const cwd = args.cwd ?? process.cwd();
    const homeDir = args.homeDir ?? os.homedir();
    const repoConfigPath = path.resolve(cwd, "sift.config.yaml");
    const globalConfigPath = getDefaultGlobalConfigPath(homeDir);
    const configPath = fs.existsSync(repoConfigPath)
      ? repoConfigPath
      : fs.existsSync(globalConfigPath)
        ? globalConfigPath
        : undefined;
    const config = resolveConfig(configPath ? { configPath } : {});
    return resolveEffectiveOperationMode(config);
  } catch {
    return "agent-escalation";
  }
}

export function renderManagedBlock(
  agent: AgentName,
  eol = "\n",
  mode: OperationMode = "agent-escalation"
): string {
  const markers = getManagedBlockMarkers(agent);
  return [markers.start, renderManagedInstructionBody(mode), markers.end].join(eol);
}

export function inspectManagedBlock(content: string, agent: AgentName): ManagedBlockInfo {
  const markers = getManagedBlockMarkers(agent);
  const beginMatches = [...content.matchAll(new RegExp(escapeRegExp(markers.start), "g"))];
  const endMatches = [...content.matchAll(new RegExp(escapeRegExp(markers.end), "g"))];
  const firstBegin = beginMatches[0];
  const firstEnd = endMatches[0];
  const firstBeginIndex = firstBegin ? firstBegin.index : -1;
  const firstEndIndex = firstEnd ? firstEnd.index : -1;
  const found = Boolean(firstBegin && firstEnd);
  const ambiguous =
    (beginMatches.length === 0) !== (endMatches.length === 0) ||
    beginMatches.length > 1 ||
    endMatches.length > 1 ||
    (found && firstBeginIndex > firstEndIndex);

  return {
    startMarker: markers.start,
    endMarker: markers.end,
    beginMatches: beginMatches.length,
    endMatches: endMatches.length,
    startIndex: firstBeginIndex,
    endIndex: firstEndIndex >= 0 ? firstEndIndex + markers.end.length : -1,
    found,
    ambiguous
  };
}

export function planManagedInstall(args: {
  agent: AgentName;
  targetPath: string;
  existingContent?: string;
  operationMode?: OperationMode;
}): AgentInstallPlan {
  const eol = args.existingContent?.includes("\r\n") ? "\r\n" : "\n";
  const block = renderManagedBlock(args.agent, eol, args.operationMode ?? "agent-escalation");

  if (args.existingContent === undefined) {
    return {
      action: "create",
      targetPath: args.targetPath,
      block,
      content: `${block}${eol}`
    };
  }

  const inspection = inspectManagedBlock(args.existingContent, args.agent);

  if (inspection.ambiguous) {
    throw new Error(
      `Found malformed or duplicate managed blocks for ${args.agent} in ${args.targetPath}. Please clean them up manually first.`
    );
  }

  if (!inspection.found) {
    const content = appendBlock(args.existingContent, block, eol);
    return {
      action: "append",
      targetPath: args.targetPath,
      block,
      content
    };
  }

  const content =
    args.existingContent.slice(0, inspection.startIndex) +
    block +
    args.existingContent.slice(inspection.endIndex);

  return {
    action: "update",
    targetPath: args.targetPath,
    block,
    content
  };
}

export function planManagedRemove(args: {
  agent: AgentName;
  targetPath: string;
  existingContent?: string;
}): { readonly changed: boolean; readonly content: string; readonly block: string } {
  if (args.existingContent === undefined) {
    return {
      changed: false,
      content: "",
      block: renderManagedBlock(args.agent)
    };
  }

  const inspection = inspectManagedBlock(args.existingContent, args.agent);
  const eol = args.existingContent.includes("\r\n") ? "\r\n" : "\n";
  const block = renderManagedBlock(args.agent, eol);

  if (inspection.ambiguous) {
    throw new Error(
      `Found malformed or duplicate managed blocks for ${args.agent} in ${args.targetPath}. Please clean them up manually first.`
    );
  }

  if (!inspection.found) {
    return {
      changed: false,
      content: args.existingContent,
      block
    };
  }

  const before = args.existingContent.slice(0, inspection.startIndex);
  const after = args.existingContent.slice(inspection.endIndex);

  return {
    changed: true,
    content: joinAroundRemoval(before, after, eol),
    block
  };
}

export function collectAgentStatus(args: {
  cwd?: string;
  homeDir?: string;
} = {}): AgentStatusRow[] {
  const rows: AgentStatusRow[] = [];

  for (const scope of ["repo", "global"] as const) {
    for (const agent of ["codex", "claude"] as const) {
      const targetPath = resolveAgentTargetPath({
        agent,
        scope,
        cwd: args.cwd,
        homeDir: args.homeDir
      });
      const existing = readOptionalFile(targetPath);
      const installed =
        existing !== undefined && inspectManagedBlock(existing, agent).found;

      rows.push({
        agent,
        scope,
        targetPath,
        fileExists: existing !== undefined,
        installed
      });
    }
  }

  return rows;
}

export function showAgent(
  args: string | AgentShowArgs,
  ioArg: Pick<AgentCommandIO, "write" | "stdoutIsTTY"> = createStdoutOnlyIO()
): void {
  const params: Required<Pick<AgentShowArgs, "scope" | "raw">> &
    Pick<ResolveAgentTargetPathArgs, "targetPath" | "cwd" | "homeDir"> &
    Pick<AgentShowArgs, "operationMode"> & {
      agent: string;
      io: Pick<AgentCommandIO, "write" | "stdoutIsTTY">;
    } =
    typeof args === "string"
      ? {
          agent: args,
          scope: "repo" as const,
          operationMode: undefined,
          raw: false,
          targetPath: undefined,
          cwd: undefined,
          homeDir: undefined,
          io: ioArg
        }
      : {
          agent: args.agent,
          scope: args.scope ?? "repo",
          operationMode: args.operationMode,
          raw: args.raw ?? false,
          targetPath: args.targetPath,
          cwd: args.cwd,
          homeDir: args.homeDir,
          io: args.io ?? ioArg
        };
  const agent = normalizeAgentName(params.agent);
  const io = params.io;

  const operationMode = inferOperationMode({
    cwd: params.cwd,
    homeDir: params.homeDir,
    operationMode: params.operationMode
  });

  if (params.raw) {
    io.write(`${renderManagedBlock(agent, "\n", operationMode)}\n`);
    return;
  }

  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const targetPath = resolveAgentTargetPath({
    agent,
    scope: params.scope,
    targetPath: params.targetPath,
    cwd: params.cwd,
    homeDir: params.homeDir
  });
  const targetLabel =
    params.scope === "repo" && !params.targetPath ? AGENT_FILENAMES[agent] : targetPath;
  const currentContent = readOptionalFile(targetPath);
  const currentInstalled =
    currentContent !== undefined && inspectManagedBlock(currentContent, agent).found;
  const otherScope = params.scope === "repo" ? "global" : "repo";
  const otherTargetPath = resolveAgentTargetPath({
    agent,
    scope: otherScope,
    cwd: params.cwd,
    homeDir: params.homeDir
  });
  const otherContent = readOptionalFile(otherTargetPath);
  const otherInstalled =
    otherContent !== undefined && inspectManagedBlock(otherContent, agent).found;

  io.write(`${ui.section(`${AGENT_TITLES[agent]} instructions preview`)}\n`);
  io.write(`${ui.labelValue("scope", params.scope)}\n`);
  io.write(
    `${ui.labelValue(params.scope === "repo" && !params.targetPath ? "target file" : "target path", targetLabel)}\n`
  );
  io.write(
    `${ui.labelValue(
      "status",
      currentInstalled ? "managed block already installed here" : "not installed in this target yet"
    )}\n`
  );
  io.write(`${ui.labelValue("operation mode", getOperationModeLabel(operationMode))}\n`);
  if (currentInstalled) {
    io.write(`${ui.warning(`Already installed in ${params.scope} scope.`)}\n`);
  }
  if (otherInstalled) {
    io.write(
      `${ui.warning(`Also installed in ${otherScope} scope at ${otherTargetPath}.`)}\n`
    );
  }
  io.write(`${ui.note("This is only a preview. Nothing will be changed.")}\n`);
  io.write(
    `${ui.info("sift will manage one marked block in this file. It will not rewrite the whole file.")}\n`
  );
  io.write(
    `${ui.info("The point is to narrow long command output before your agent burns time and tokens on the raw log wall.")}\n`
  );
  io.write(
    `${ui.info("The managed block teaches the agent to default to sift first, keep raw as the last resort, and treat standard as the usual stop point.")}\n`
  );
  io.write(`${ui.note(describeOperationMode(operationMode))}\n`);
  io.write(`${ui.note(describeInsufficientBehavior(operationMode))}\n`);
  io.write(`${ui.note(getDefaultExecPathLine())}\n`);
  io.write(`${ui.note(getHookBetaLine())}\n`);
  io.write(`${ui.note(getExecVsHookDecisionLine())}\n`);
  io.write(`  ${ui.command('sift exec "question" -- <command> [args...]')}\n`);
  io.write(`  ${ui.command("sift exec --preset test-status -- <test command>")}\n`);
  io.write(`  ${ui.command("sift exec --preset audit-critical -- npm audit")}\n`);
  io.write(`  ${ui.command("sift exec --preset infra-risk -- terraform plan")}\n`);
  io.write(`  ${ui.command("sift hook match -- pytest -q")}${ui.note("  # optional beta shortcut for a known preset")}\n`);
  io.write(
    `${ui.info("For test debugging, standard should usually be enough for first-pass guidance.")}\n`
  );
  io.write(
    `${ui.note("If standard already names the main failure buckets and hints, stop there and read source.")}\n`
  );
  io.write(
    `${ui.note(`Use ${ui.command("sift escalate")} when you want a deeper render of the same cached output without rerunning the command.`)}\n`
  );
  io.write(
    `${ui.note(`After a fix, refresh the truth with ${ui.command("sift rerun")} so the full suite runs again at standard.`)}\n`
  );
  io.write(
    `${ui.note(`Only then zoom into what is still broken with ${ui.command("sift rerun --remaining --detail focused")}, then ${ui.command("sift rerun --remaining --detail verbose")}, then ${ui.command("sift rerun --remaining --detail verbose --show-raw")} if needed.`)}\n`
  );
  io.write(
    `${ui.note("Use diagnose JSON only for automation or machine branching. It is summary-first by default, and full test IDs stay opt-in.")}\n`
  );
  io.write(
    `${ui.note("If standard already shows bucket-level root cause, anchor, and fix lines, report from it directly and avoid re-verifying the same bucket with raw pytest.")}\n`
  );
  io.write(
    `${ui.note("At most do one targeted source read before you edit when standard already points to the right file or line range.")}\n`
  );
  io.write(
    `${ui.note("Only fall back to the raw test command if exact traceback lines are still needed for the remaining failing subset.")}\n`
  );
  if (agent === "codex") {
    const skillTargetPath = resolveSkillTargetPath({
      runtime: "codex",
      scope: params.scope,
      cwd: params.cwd,
      homeDir: params.homeDir
    });
    io.write(
      `${ui.info("Codex also gets a tiny native skill so the runtime has a real `sift` entry point beyond `AGENTS.md`.")}\n`
    );
    io.write(`${ui.labelValue("skill target", skillTargetPath)}\n`);
    io.write(
      `${ui.labelValue(
        "skill status",
        describeSkillStatus(readOptionalFile(skillTargetPath), skillTargetPath)
      )}\n`
    );
  }
  if (agent === "claude") {
    const commandPack = planClaudeCommandPack({
      scope: params.scope,
      cwd: params.cwd,
      homeDir: params.homeDir,
      operationMode
    });
    io.write(
      `${ui.info("Claude also gets a tiny native command pack so the runtime has real `sift` entry points beyond `CLAUDE.md`.")}\n`
    );
    io.write(`${ui.labelValue("command pack target", commandPack.targetDir)}\n`);
    io.write(`${ui.note("Installed commands: /sift:help, /sift:test-status, /sift:doctor")}\n`);
    if (commandPack.hasConflict) {
      io.write(
        `${ui.warning("A custom Claude command file is already present at the target path. sift would refuse to overwrite it.")}\n`
      );
    }
  }
  io.write(`${ui.note("Use --raw to print the exact managed block.")}\n`);
}

export async function installAgent(args: AgentInstallArgs): Promise<number> {
  const io = args.io ?? createAgentTerminalIO();
  const agent = normalizeAgentName(args.agent);
  const scope = args.scope ?? "repo";
  const targetPath = resolveAgentTargetPath({
    agent,
    scope,
    targetPath: args.targetPath,
    cwd: args.cwd,
    homeDir: args.homeDir
  });
  const ui = createPresentation(io.stdoutIsTTY);
  const operationMode = inferOperationMode({
    cwd: args.cwd,
    homeDir: args.homeDir,
    operationMode: args.operationMode
  });

  try {
    const existingContent = readOptionalFile(targetPath);
    const fileExists = existingContent !== undefined;
    const inspection =
      existingContent !== undefined
        ? inspectManagedBlock(existingContent, agent)
        : undefined;
    const plan = planManagedInstall({
      agent,
      targetPath,
      existingContent,
      operationMode
    });
    const codexSkillTargetPath =
      agent === "codex"
        ? resolveSkillTargetPath({
            runtime: "codex",
            scope,
            cwd: args.cwd,
            homeDir: args.homeDir
          })
        : undefined;
    const codexSkillOwnership =
      codexSkillTargetPath !== undefined
        ? inspectSkillOwnership(readOptionalFile(codexSkillTargetPath))
        : undefined;
    const claudeCommandPack =
      agent === "claude"
        ? planClaudeCommandPack({
            scope,
            cwd: args.cwd,
            homeDir: args.homeDir,
            operationMode
          })
        : undefined;

    if (args.dryRun) {
      if (args.raw) {
        io.write(`${plan.content}\n`);
        return 0;
      }

      io.write(
        `${ui.section(`Dry run: ${plan.action} ${AGENT_TITLES[agent]} managed block`)}\n`
      );
      io.write(`${ui.labelValue("scope", scope)}\n`);
      io.write(`${ui.labelValue("target", targetPath)}\n`);
      io.write(`${ui.labelValue("file exists", fileExists ? "yes" : "no")}\n`);
      io.write(
        `${ui.labelValue(
          "managed block exists",
          inspection?.found ? "yes" : "no"
        )}\n`
      );
      io.write(
        `${ui.labelValue(
          "result",
          plan.action === "create"
            ? "create a new managed block file"
            : plan.action === "append"
              ? "append the managed block and keep surrounding notes untouched"
              : "update only the existing managed block and keep surrounding notes untouched"
        )}\n`
      );
      io.write(
        `${ui.warning("Only the managed sift block would be written or updated.")}\n`
      );
      if (codexSkillTargetPath) {
        io.write(
          `${ui.labelValue(
            "codex skill",
            codexSkillOwnership === "missing"
              ? "create a generated SKILL.md"
              : codexSkillOwnership === "custom"
                ? "custom SKILL.md present; install would stop before overwriting it"
                : "update the generated SKILL.md"
          )}\n`
        );
        io.write(`${ui.labelValue("skill target", codexSkillTargetPath)}\n`);
      }
      if (claudeCommandPack) {
        io.write(
          `${ui.labelValue(
            "claude command pack",
            claudeCommandPack.hasConflict
              ? "custom command file present; install would stop before overwriting it"
              : claudeCommandPack.action === "create"
                ? `create ${claudeCommandPack.files.length} generated command files`
                : `update ${claudeCommandPack.files.length} generated command files`
          )}\n`
        );
        io.write(`${ui.labelValue("command pack target", claudeCommandPack.targetDir)}\n`);
      }
      io.write(
        `${ui.note(
          scope === "repo"
            ? "Repo scope is the safer default."
            : "Global scope writes to your machine-wide agent instructions."
        )}\n`
      );
      io.write(`${ui.note("Use --raw to print the exact content that would be written.")}\n`);
      return 0;
    }

    if (!args.dryRun) {
      if ((!io.stdinIsTTY || !io.stdoutIsTTY) && !args.yes) {
        io.error("sift agent install requires --yes in non-interactive mode.\n");
        return 1;
      }

      io.write(`${ui.section(`${AGENT_TITLES[agent]} instructions`)}\n`);
      io.write(`${ui.labelValue("scope", scope)}\n`);
      io.write(`${ui.labelValue("target", targetPath)}\n`);
      io.write(`${ui.labelValue("operation mode", getOperationModeLabel(operationMode))}\n`);
      io.write(`${ui.info("This will only manage the sift block.")}\n`);
      io.write(
        `${ui.warning("Your other notes in this file will stay untouched.")}\n`
      );
      io.write(
        `${ui.note(
          scope === "repo"
            ? "Repo scope is the safer default."
            : "Global scope writes to your machine-wide agent instructions."
        )}\n`
      );

      if (existingContent !== undefined && !args.yes) {
        const confirmed = await promptForConfirmation(
          io,
          buildInstallConfirmationPrompt({
            agent,
            action: plan.action === "append" ? "append" : "update",
            targetPath
          })
        );
        if (!confirmed) {
          io.write(`${ui.note("Aborted.")}\n`);
          return 1;
        }
      }
    }

    if (codexSkillOwnership === "custom") {
      io.error(
        `Refusing to overwrite a custom Codex SKILL.md at ${codexSkillTargetPath}. Clean it up manually or choose a different target.\n`
      );
      return 1;
    }

    if (claudeCommandPack?.hasConflict) {
      const conflict = claudeCommandPack.files.find((file) => file.action === "conflict");
      io.error(
        `Refusing to overwrite a custom Claude command file at ${conflict?.targetPath ?? claudeCommandPack.targetDir}. Clean it up manually or choose a different target.\n`
      );
      return 1;
    }

    writeTextFileAtomic(targetPath, plan.content);
    if (codexSkillTargetPath) {
      writeTextFileAtomic(codexSkillTargetPath, `${renderCodexSkill(operationMode)}\n`);
    }
    if (claudeCommandPack) {
      writeClaudeCommandPack(claudeCommandPack);
    }
    io.write(`${ui.success(`${AGENT_TITLES[agent]} managed block updated.`)}\n`);
    io.write(`${ui.note(`${targetPath}`)}\n`);
    if (codexSkillTargetPath) {
      io.write(`${ui.note(`Codex skill updated in ${codexSkillTargetPath}`)}\n`);
    }
    if (claudeCommandPack) {
      io.write(`${ui.note(`Claude command pack updated in ${claudeCommandPack.targetDir}`)}\n`);
    }
    return 0;
  } finally {
    io.close?.();
  }
}

export async function removeAgent(args: AgentRemoveArgs): Promise<number> {
  const io = args.io ?? createAgentTerminalIO();
  const agent = normalizeAgentName(args.agent);
  const scope = args.scope ?? "repo";
  const targetPath = resolveAgentTargetPath({
    agent,
    scope,
    targetPath: args.targetPath,
    cwd: args.cwd,
    homeDir: args.homeDir
  });
  const ui = createPresentation(io.stdoutIsTTY);

  try {
    const existingContent = readOptionalFile(targetPath);
    const plan = planManagedRemove({
      agent,
      targetPath,
      existingContent
    });
    const claudeCommandPackTarget =
      agent === "claude"
        ? resolveClaudeCommandPackTargetDir({
            scope,
            cwd: args.cwd,
            homeDir: args.homeDir
          })
        : undefined;
    const codexSkillTargetPath =
      agent === "codex"
        ? resolveSkillTargetPath({
            runtime: "codex",
            scope,
            cwd: args.cwd,
            homeDir: args.homeDir
          })
        : undefined;
    const codexSkillOwnership =
      codexSkillTargetPath !== undefined
        ? inspectSkillOwnership(readOptionalFile(codexSkillTargetPath))
        : undefined;

    const claudeCommandRemoval =
      claudeCommandPackTarget !== undefined
        ? inspectClaudeCommandPackRemoval(claudeCommandPackTarget)
        : undefined;

    if (!plan.changed) {
      io.write(`${ui.note(`No managed ${AGENT_TITLES[agent]} block found at ${targetPath}.`)}\n`);
      if (
        (!claudeCommandRemoval || claudeCommandRemoval.removableFiles.length === 0) &&
        codexSkillOwnership !== "managed" &&
        codexSkillOwnership !== "legacy-managed"
      ) {
        return 0;
      }
    }

    if (args.dryRun) {
      io.write(
        `${ui.section(`Dry run: remove ${AGENT_TITLES[agent]} managed block`)}\n`
      );
      io.write(`${ui.labelValue("scope", scope)}\n`);
      io.write(`${ui.labelValue("target", targetPath)}\n`);
      io.write(
        `${ui.warning("Only the managed sift block would be removed.")}\n`
      );
      io.write(`${ui.note("Other content in the file would be preserved.")}\n`);
      return 0;
    }

    if ((!io.stdinIsTTY || !io.stdoutIsTTY) && !args.yes) {
      io.error("sift agent remove requires --yes in non-interactive mode.\n");
      return 1;
    }

    io.write(`${ui.section(`${AGENT_TITLES[agent]} instructions`)}\n`);
    io.write(`${ui.labelValue("scope", scope)}\n`);
    io.write(`${ui.labelValue("target", targetPath)}\n`);
    io.write(`${ui.warning("Only the managed sift block will be removed.")}\n`);
    io.write(`${ui.note("Other content in the file will be preserved.")}\n`);

    if (!args.yes) {
      const confirmed = await promptForConfirmation(
        io,
        `Remove only the managed ${AGENT_TITLES[agent]} block from ${targetPath}? Other content will be preserved. [y/N]: `
      );
      if (!confirmed) {
        io.write(`${ui.note("Aborted.")}\n`);
        return 1;
      }
    }

    if (plan.changed) {
      writeTextFileAtomic(targetPath, plan.content);
      io.write(`${ui.success(`${AGENT_TITLES[agent]} managed block removed.`)}\n`);
      io.write(`${ui.note(`${targetPath}`)}\n`);
    }
    if (codexSkillTargetPath) {
      if (codexSkillOwnership === "managed" || codexSkillOwnership === "legacy-managed") {
        fs.unlinkSync(codexSkillTargetPath);
        cleanupEmptyDirectories(path.dirname(codexSkillTargetPath), path.resolve(path.dirname(codexSkillTargetPath), "..", ".."));
        io.write(`${ui.note(`Removed the generated Codex skill at ${codexSkillTargetPath}`)}\n`);
      } else if (codexSkillOwnership === "custom") {
        io.write(`${ui.warning(`Left custom Codex SKILL.md untouched at ${codexSkillTargetPath}.`)}\n`);
      }
    }
    if (claudeCommandPackTarget) {
      const commandRemoval = removeClaudeCommandPack(claudeCommandRemoval ?? inspectClaudeCommandPackRemoval(claudeCommandPackTarget));
      if (commandRemoval.removedFiles.length > 0) {
        io.write(`${ui.note(`Removed ${commandRemoval.removedFiles.length} generated Claude command file(s) from ${claudeCommandPackTarget}`)}\n`);
      } else {
        io.write(`${ui.note(`No sift-owned Claude command files found in ${claudeCommandPackTarget}.`)}\n`);
      }
      if (commandRemoval.customFiles.length > 0) {
        io.write(`${ui.warning(`Left ${commandRemoval.customFiles.length} custom Claude command file(s) untouched.`)}\n`);
      }
    }
    return 0;
  } finally {
    io.close?.();
  }
}

export function statusAgents(args: {
  cwd?: string;
  homeDir?: string;
  io?: Pick<AgentCommandIO, "write" | "stdoutIsTTY">;
} = {}): void {
  const io = args.io ?? {
    write(message: string) {
      process.stdout.write(message);
    },
    stdoutIsTTY: Boolean(process.stdout.isTTY)
  };
  const ui = createPresentation(io.stdoutIsTTY);
  const rows = collectAgentStatus({
    cwd: args.cwd,
    homeDir: args.homeDir
  });

  io.write(`${ui.section("Agent installer status")}\n`);

  for (const scope of ["repo", "global"] as const) {
    io.write(`${ui.section(scope === "repo" ? "Repo scope" : "Global scope")}\n`);
    for (const row of rows.filter((entry) => entry.scope === scope)) {
      const status = `${AGENT_TITLES[row.agent]} managed block: ${row.installed ? "installed" : "not installed"} (${row.fileExists ? "file exists" : "file missing"})`;
      io.write(`  ${row.installed ? ui.success(status) : ui.warning(status)}\n`);
      io.write(`    ${row.targetPath}\n`);
      if (row.agent === "codex") {
        const skillPath = resolveSkillTargetPath({
          runtime: "codex",
          scope,
          cwd: args.cwd,
          homeDir: args.homeDir
        });
        const skillStatus = describeSkillStatus(readOptionalFile(skillPath), skillPath);
        const styled =
          skillStatus.startsWith("installed")
            ? ui.success(`Codex skill: ${skillStatus}`)
            : skillStatus.startsWith("custom")
              ? ui.warning(`Codex skill: ${skillStatus}`)
              : ui.warning(`Codex skill: ${skillStatus}`);
        io.write(`  ${styled}\n`);
      }
      if (row.agent === "claude") {
        const packStatus = describeClaudeCommandPackStatus(
          resolveClaudeCommandPackTargetDir({
            scope,
            cwd: args.cwd,
            homeDir: args.homeDir
          })
        );
        const styled =
          packStatus.startsWith("installed") || packStatus.startsWith("partial")
            ? ui.success(`Claude command pack: ${packStatus}`)
            : packStatus.startsWith("custom")
              ? ui.warning(`Claude command pack: ${packStatus}`)
              : ui.warning(`Claude command pack: ${packStatus}`);
        io.write(`  ${styled}\n`);
      }
    }
  }
}

function promptForConfirmation(io: AgentCommandIO, prompt: string): Promise<boolean> {
  return io.ask(prompt).then((answer) => {
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  });
}

function buildInstallConfirmationPrompt(args: {
  agent: AgentName;
  action: Exclude<AgentPlanAction, "create">;
  targetPath: string;
}): string {
  if (args.action === "append") {
    return `Append the managed ${AGENT_TITLES[args.agent]} block to ${args.targetPath}? Existing content will be preserved. [y/N]: `;
  }

  return `Update the managed ${AGENT_TITLES[args.agent]} block in ${args.targetPath}? Existing content outside the block will be preserved. [y/N]: `;
}

function appendBlock(existingContent: string, block: string, eol: string): string {
  if (existingContent.length === 0) {
    return `${block}${eol}`;
  }

  let separator = "";

  if (!existingContent.endsWith(eol)) {
    separator += eol;
  }

  if (!existingContent.endsWith(`${eol}${eol}`)) {
    separator += eol;
  }

  return `${existingContent}${separator}${block}${eol}`;
}

function joinAroundRemoval(before: string, after: string, eol: string): string {
  const left = before.replace(/[ \t]+$/gm, "").replace(/(?:\r?\n)+$/, "");
  const right = after.replace(/^[ \t]+/gm, "").replace(/^(?:\r?\n)+/, "");

  if (!left && !right) {
    return "";
  }

  if (!left) {
    return right;
  }

  if (!right) {
    return `${left}${eol}`;
  }

  return `${left}${eol}${eol}${right}`;
}

function readOptionalFile(targetPath: string): string | undefined {
  if (!fs.existsSync(targetPath)) {
    return undefined;
  }

  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error(`${targetPath} exists but is not a file.`);
  }

  return fs.readFileSync(targetPath, "utf8");
}

function writeTextFileAtomic(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, targetPath);
}

function planClaudeCommandPack(args: {
  scope: AgentScope;
  cwd?: string;
  homeDir?: string;
  operationMode: OperationMode;
}): ClaudeCommandPackPlan {
  const targetDir = resolveClaudeCommandPackTargetDir(args);
  const rendered = renderClaudeCommandPack(args.operationMode);
  const files: ClaudeCommandFilePlan[] = Object.entries(rendered).map(([name, content]) => {
    const targetPath = path.join(targetDir, name);
    const ownership = inspectClaudeCommandOwnership(readOptionalFile(targetPath), name as `${ClaudeCommandName}.md`);
    const action: ClaudeCommandFilePlan["action"] =
      ownership === "missing"
        ? "create"
        : ownership === "custom"
          ? "conflict"
          : "update";
    return {
      name: name as `${ClaudeCommandName}.md`,
      targetPath,
      content: `${content}\n`,
      ownership,
      action
    };
  });

  return {
    targetDir,
    files,
    hasConflict: files.some((file) => file.action === "conflict"),
    action: files.every((file) => file.action === "create") ? "create" : "update"
  };
}

function inspectClaudeCommandOwnership(
  content: string | undefined,
  name: `${ClaudeCommandName}.md`
): "managed" | "missing" | "custom" {
  if (content === undefined) {
    return "missing";
  }

  const commandName = name.replace(/\.md$/, "") as ClaudeCommandName;
  return content.includes(getClaudeCommandMarker(commandName)) ? "managed" : "custom";
}

function writeClaudeCommandPack(plan: ClaudeCommandPackPlan): void {
  for (const file of plan.files) {
    writeTextFileAtomic(file.targetPath, file.content);
  }
}

function inspectClaudeCommandPackRemoval(targetDir: string): {
  targetDir: string;
  removableFiles: string[];
  customFiles: string[];
} {
  const removableFiles: string[] = [];
  const customFiles: string[] = [];

  for (const name of CLAUDE_COMMAND_NAMES) {
    const targetPath = path.join(targetDir, `${name}.md`);
    const ownership = inspectClaudeCommandOwnership(readOptionalFile(targetPath), `${name}.md`);

    if (ownership === "managed") {
      removableFiles.push(targetPath);
    } else if (ownership === "custom") {
      customFiles.push(targetPath);
    }
  }

  return {
    targetDir,
    removableFiles,
    customFiles
  };
}

function removeClaudeCommandPack(plan: {
  targetDir: string;
  removableFiles: string[];
  customFiles: string[];
}): {
  removedFiles: string[];
  customFiles: string[];
} {
  const removedFiles: string[] = [];

  for (const targetPath of plan.removableFiles) {
    fs.unlinkSync(targetPath);
    removedFiles.push(targetPath);
  }

  cleanupEmptyDirectories(plan.targetDir, path.dirname(path.dirname(plan.targetDir)));
  return { removedFiles, customFiles: plan.customFiles };
}

function describeClaudeCommandPackStatus(targetDir: string): string {
  let managed = 0;
  let custom = 0;

  for (const name of CLAUDE_COMMAND_NAMES) {
    const ownership = inspectClaudeCommandOwnership(
      readOptionalFile(path.join(targetDir, `${name}.md`)),
      `${name}.md`
    );

    if (ownership === "managed") {
      managed += 1;
    } else if (ownership === "custom") {
      custom += 1;
    }
  }

  if (custom > 0) {
    return `custom files present (${targetDir})`;
  }

  if (managed === 0) {
    return `not installed (${targetDir})`;
  }

  if (managed < CLAUDE_COMMAND_NAMES.length) {
    return `partial (${targetDir})`;
  }

  return `installed (${targetDir})`;
}

function cleanupEmptyDirectories(startDir: string, stopDir: string): void {
  let current = startDir;

  while (current.startsWith(stopDir) && current !== stopDir) {
    try {
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
