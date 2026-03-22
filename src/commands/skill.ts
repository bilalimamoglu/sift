import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDefaultCodexGlobalSkillPath } from "../constants.js";
import { getDefaultExecPathLine, getHookBetaLine } from "../content/adoption.js";
import { CODEX_SKILL_MARKER, renderCodexSkill } from "../runtime-payloads/codex-skill.js";
import { resolveConfig, resolveEffectiveOperationMode } from "../config/resolve.js";
import type { OperationMode } from "../types.js";
import { createPresentation } from "../ui/presentation.js";

export type SkillRuntime = "codex";
export type SkillScope = "repo" | "global";

export interface SkillCommandIO {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  ask(prompt: string): Promise<string>;
  write(message: string): void;
  error(message: string): void;
  close?(): void;
}

export interface SkillShowArgs {
  runtime: SkillRuntime;
  scope?: SkillScope;
  targetPath?: string;
  cwd?: string;
  homeDir?: string;
  raw?: boolean;
  operationMode?: OperationMode;
  io?: Pick<SkillCommandIO, "write" | "stdoutIsTTY">;
}

export interface SkillInstallArgs extends SkillShowArgs {
  dryRun?: boolean;
  yes?: boolean;
  io?: SkillCommandIO;
}

export interface SkillRemoveArgs {
  runtime: SkillRuntime;
  scope?: SkillScope;
  targetPath?: string;
  cwd?: string;
  homeDir?: string;
  dryRun?: boolean;
  yes?: boolean;
  io?: SkillCommandIO;
}

export type SkillOwnershipState = "managed" | "legacy-managed" | "custom" | "missing";

function createStdoutOnlyIO(): Pick<SkillCommandIO, "write" | "stdoutIsTTY"> {
  return {
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    write(message: string) {
      process.stdout.write(message);
    }
  };
}

function createTerminalIO(): SkillCommandIO {
  return {
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    ask(prompt: string) {
      process.stdout.write(prompt);
      return Promise.resolve("");
    },
    write(message: string) {
      process.stdout.write(message);
    },
    error(message: string) {
      process.stderr.write(message);
    }
  };
}

export function normalizeSkillRuntime(value: string): SkillRuntime {
  if (value === "codex") {
    return value;
  }

  throw new Error("Unknown skill runtime. Use codex.");
}

export function normalizeSkillScope(value: unknown): SkillScope | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "repo" || value === "global") {
    return value;
  }

  if (value === "local") {
    return "repo";
  }

  throw new Error("Invalid --scope value. Use repo or global.");
}

export function resolveSkillTargetPath(args: {
  runtime: SkillRuntime;
  scope?: SkillScope;
  targetPath?: string;
  cwd?: string;
  homeDir?: string;
}): string {
  if (args.targetPath) {
    return path.resolve(args.cwd ?? process.cwd(), args.targetPath);
  }

  const scope = args.scope ?? "repo";
  if (scope === "global") {
    return getDefaultCodexGlobalSkillPath(args.homeDir ?? os.homedir());
  }

  return path.resolve(args.cwd ?? process.cwd(), ".codex", "skills", "sift", "SKILL.md");
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
    const globalConfigPath = path.join(homeDir, ".config", "sift", "config.yaml");
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

export function showSkill(args: SkillShowArgs): void {
  const io = args.io ?? createStdoutOnlyIO();
  const targetPath = resolveSkillTargetPath(args);
  const mode = inferOperationMode(args);
  const content = renderCodexSkill(mode);

  if (args.raw) {
    io.write(`${content}\n`);
    return;
  }

  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const ownership = inspectSkillOwnership(readOptionalSkillFile(targetPath));
  const status =
    ownership === "managed" || ownership === "legacy-managed"
      ? "sift-managed skill already installed here"
      : ownership === "custom"
        ? "custom SKILL.md present here; sift will not overwrite it"
        : "not installed yet";

  io.write(`${ui.section("Codex skill preview")}\n`);
  io.write(`${ui.labelValue("scope", args.scope ?? "repo")}\n`);
  io.write(`${ui.labelValue("target", targetPath)}\n`);
  io.write(`${ui.labelValue("status", status)}\n`);
  io.write(`${ui.info("This is a tiny Codex-native workflow guide, not a second runtime or command system.")}\n`);
  io.write(`${ui.note(getDefaultExecPathLine())}\n`);
  io.write(`${ui.note(getHookBetaLine())}\n`);
  io.write(`${ui.note("The skill complements the CLI and managed block. It does not replace them.")}\n`);
  io.write(`${ui.note("sift only updates or removes SKILL.md when the file is clearly owned by sift.")}\n`);
  io.write(`  ${ui.command("sift exec --preset test-status -- pytest -q")}\n`);
  io.write(`  ${ui.command("sift hook match -- pytest -q")}${ui.note("  # optional beta shortcut")}\n`);
  io.write(`${ui.note("Use --raw to print the exact SKILL.md content.")}\n`);
}

export async function installSkill(args: SkillInstallArgs): Promise<number> {
  const io = args.io ?? createTerminalIO();
  const targetPath = resolveSkillTargetPath(args);
  const mode = inferOperationMode(args);
  const content = `${renderCodexSkill(mode)}\n`;
  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const existingContent = readOptionalSkillFile(targetPath);
  const ownership = inspectSkillOwnership(existingContent);
  const action =
    ownership === "missing"
      ? "create"
      : ownership === "custom"
        ? "conflict"
        : "update";

  if (args.dryRun) {
    if (args.raw) {
      io.write(content);
      return 0;
    }

    io.write(`${ui.section(`Dry run: ${action === "update" ? "update" : "create"} Codex skill`)}\n`);
    io.write(`${ui.labelValue("scope", args.scope ?? "repo")}\n`);
    io.write(`${ui.labelValue("target", targetPath)}\n`);
    io.write(`${ui.labelValue("file exists", existingContent !== undefined ? "yes" : "no")}\n`);
    io.write(
      `${ui.labelValue(
        "ownership",
        ownership === "missing"
          ? "no file"
          : ownership === "custom"
            ? "custom file present"
            : ownership === "legacy-managed"
              ? "legacy sift-managed file"
              : "sift-managed file"
      )}\n`
    );
    io.write(`${ui.note("This writes a single generated SKILL.md file for Codex discoverability.")}\n`);
    if (ownership === "custom") {
      io.write(`${ui.warning("A custom SKILL.md already exists here, so sift would refuse to overwrite it.")}\n`);
    }
    io.write(`${ui.note("Use --raw to print the exact content that would be written.")}\n`);
    return 0;
  }

  if (!args.yes && !io.stdinIsTTY) {
    io.error("sift skill install requires --yes in non-interactive mode.\n");
    return 1;
  }

  if (ownership === "custom") {
    io.error(`Refusing to overwrite a custom SKILL.md at ${targetPath}. Move it, remove it manually, or choose a different target path.\n`);
    return 1;
  }

  writeTextFileAtomic(targetPath, content);
  io.write(`${ui.success(`Codex skill ${action === "update" ? "updated" : "installed"}.`)}\n`);
  io.write(`${ui.labelValue("target", targetPath)}\n`);
  return 0;
}

export async function removeSkill(args: SkillRemoveArgs): Promise<number> {
  const io = args.io ?? createTerminalIO();
  const targetPath = resolveSkillTargetPath(args);
  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const existingContent = readOptionalSkillFile(targetPath);
  const ownership = inspectSkillOwnership(existingContent);

  if (args.dryRun) {
    io.write(`${ui.section("Dry run: remove Codex skill")}\n`);
    io.write(`${ui.labelValue("target", targetPath)}\n`);
    io.write(`${ui.labelValue("file exists", existingContent !== undefined ? "yes" : "no")}\n`);
    io.write(
      `${ui.labelValue(
        "ownership",
        ownership === "missing"
          ? "no file"
          : ownership === "custom"
            ? "custom file present"
            : ownership === "legacy-managed"
              ? "legacy sift-managed file"
              : "sift-managed file"
      )}\n`
    );
    return 0;
  }

  if (!args.yes && !io.stdinIsTTY) {
    io.error("sift skill remove requires --yes in non-interactive mode.\n");
    return 1;
  }

  if (ownership === "missing") {
    io.write(`${ui.note("No Codex skill found at the target path.")}\n`);
    return 0;
  }

  if (ownership === "custom") {
    io.error(`Refusing to remove a custom SKILL.md at ${targetPath} because it is not clearly owned by sift.\n`);
    return 1;
  }

  fs.unlinkSync(targetPath);
  cleanupEmptyDirectories(path.dirname(targetPath), args.scope ?? "repo", args.cwd, args.homeDir);
  io.write(`${ui.success("Codex skill removed.")}\n`);
  return 0;
}

function cleanupEmptyDirectories(
  startDir: string,
  scope: SkillScope,
  cwd?: string,
  homeDir?: string
): void {
  const stopDir =
    scope === "global"
      ? path.join(homeDir ?? os.homedir(), ".codex")
      : path.resolve(cwd ?? process.cwd(), ".codex");

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

export function statusSkills(args: {
  cwd?: string;
  homeDir?: string;
  io?: Pick<SkillCommandIO, "write" | "stdoutIsTTY">;
} = {}): void {
  const io = args.io ?? createStdoutOnlyIO();
  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const repoPath = resolveSkillTargetPath({ runtime: "codex", scope: "repo", cwd: args.cwd });
  const globalPath = resolveSkillTargetPath({
    runtime: "codex",
    scope: "global",
    homeDir: args.homeDir
  });
  const repoStatus = describeSkillStatus(readOptionalSkillFile(repoPath), repoPath);
  const globalStatus = describeSkillStatus(readOptionalSkillFile(globalPath), globalPath);

  io.write(`${ui.section("Codex skill status")}\n`);
  io.write(`${ui.labelValue("repo", repoStatus)}\n`);
  io.write(`${ui.labelValue("global", globalStatus)}\n`);
}

export function inspectSkillOwnership(content: string | undefined): SkillOwnershipState {
  if (content === undefined) {
    return "missing";
  }

  if (content.includes(CODEX_SKILL_MARKER)) {
    return "managed";
  }

  if (
    content.includes("name: sift") &&
    content.includes("## Decision Table") &&
    content.includes("The CLI is the product runtime. This skill is a discoverability and workflow guide for Codex.")
  ) {
    return "legacy-managed";
  }

  return "custom";
}

export function describeSkillStatus(content: string | undefined, targetPath: string): string {
  const ownership = inspectSkillOwnership(content);

  if (ownership === "missing") {
    return `not installed (${targetPath})`;
  }

  if (ownership === "custom") {
    return `custom file present (${targetPath})`;
  }

  return `installed (${targetPath})`;
}

function readOptionalSkillFile(targetPath: string): string | undefined {
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
