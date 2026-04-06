import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getDefaultCodexGlobalSkillPath,
  getDefaultCursorGlobalSkillPath
} from "../constants.js";
import { getDefaultExecPathLine, getHookBetaLine } from "../content/adoption.js";
import { CODEX_SKILL_MARKER, renderCodexSkill } from "../runtime-payloads/codex-skill.js";
import { CURSOR_SKILL_MARKER, renderCursorSkill } from "../runtime-payloads/cursor-skill.js";
import { resolveConfig, resolveEffectiveOperationMode } from "../config/resolve.js";
import {
  describeSharedGuideStatus,
  getSharedGuideReference,
  inspectSharedGuideOwnership,
  readOptionalSharedGuide,
  removeSharedGuideIfUnused,
  resolveSharedGuideTargetPath,
  writeSharedGuide
} from "../shared-guide.js";
import type { OperationMode } from "../types.js";
import { createPresentation } from "../ui/presentation.js";

export type SkillRuntime = "codex" | "cursor";
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
  if (value === "codex" || value === "cursor") {
    return value;
  }

  throw new Error("Unknown skill runtime. Use codex or cursor.");
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
    return args.runtime === "codex"
      ? getDefaultCodexGlobalSkillPath(args.homeDir ?? os.homedir())
      : getDefaultCursorGlobalSkillPath(args.homeDir ?? os.homedir());
  }

  return path.resolve(
    args.cwd ?? process.cwd(),
    args.runtime === "codex" ? ".codex" : ".cursor",
    "skills",
    "sift",
    "SKILL.md"
  );
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

function getSkillTitle(runtime: SkillRuntime): string {
  return runtime === "codex" ? "Codex" : "Cursor";
}

function renderSkillForRuntime(
  runtime: SkillRuntime,
  mode: OperationMode,
  guideReference: string
): string {
  return runtime === "codex"
    ? renderCodexSkill(mode, guideReference)
    : renderCursorSkill(mode, guideReference);
}

function getSkillMarker(runtime: SkillRuntime): string {
  return runtime === "codex" ? CODEX_SKILL_MARKER : CURSOR_SKILL_MARKER;
}

function getSkillOwnerNote(runtime: SkillRuntime): string {
  return runtime === "codex"
    ? "The CLI is the product runtime. This skill is a discoverability and workflow guide for Codex."
    : "The CLI is the product runtime. This skill is a discoverability and workflow guide for Cursor.";
}

function getSkillPreviewNote(runtime: SkillRuntime): string {
  return runtime === "codex"
    ? "This is a tiny Codex-native pointer, not a second runtime or command system."
    : "This is a tiny Cursor-native pointer, not a second runtime or command system.";
}

function getSkillInstallNote(runtime: SkillRuntime): string {
  return runtime === "codex"
    ? "This writes a single generated SKILL.md file for Codex discoverability."
    : "This writes a single generated SKILL.md file for Cursor discoverability.";
}

function getCompatibleCodexSkillPath(args: {
  scope?: SkillScope;
  cwd?: string;
  homeDir?: string;
}): string {
  return resolveSkillTargetPath({
    runtime: "codex",
    scope: args.scope,
    cwd: args.cwd,
    homeDir: args.homeDir
  });
}

function inspectCompatibleCodexOwnership(args: {
  runtime: SkillRuntime;
  scope?: SkillScope;
  cwd?: string;
  homeDir?: string;
}): SkillOwnershipState {
  if (args.runtime !== "cursor") {
    return "missing";
  }

  return inspectSkillOwnership(readOptionalSkillFile(getCompatibleCodexSkillPath(args)), "codex");
}

export function showSkill(args: SkillShowArgs): void {
  const io = args.io ?? createStdoutOnlyIO();
  const targetPath = resolveSkillTargetPath(args);
  const scope = args.scope ?? "repo";
  const mode = inferOperationMode(args);
  const guidePath = resolveSharedGuideTargetPath({
    scope,
    cwd: args.cwd,
    homeDir: args.homeDir
  });
  const guideReference = getSharedGuideReference(scope);
  const content = renderSkillForRuntime(args.runtime, mode, guideReference);

  if (args.raw) {
    io.write(`${content}\n`);
    return;
  }

  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const ownership = inspectSkillOwnership(readOptionalSkillFile(targetPath), args.runtime);
  const compatibleCodexOwnership = inspectCompatibleCodexOwnership(args);
  const guideStatus = describeSharedGuideStatus(
    readOptionalSharedGuide(guidePath),
    guidePath
  );
  const status =
    ownership === "managed" || ownership === "legacy-managed"
      ? "sift-managed skill already installed here"
      : ownership === "custom"
        ? "custom SKILL.md present here; sift will not overwrite it"
        : "not installed yet";

  io.write(`${ui.section(`${getSkillTitle(args.runtime)} skill preview`)}\n`);
  io.write(`${ui.labelValue("scope", scope)}\n`);
  io.write(`${ui.labelValue("target", targetPath)}\n`);
  io.write(`${ui.labelValue("status", status)}\n`);
  io.write(`${ui.info(getSkillPreviewNote(args.runtime))}\n`);
  if (args.runtime === "cursor" && (compatibleCodexOwnership === "managed" || compatibleCodexOwnership === "legacy-managed")) {
    io.write(
      `${ui.note(
        `Cursor already loads the compatible Codex skill at ${getCompatibleCodexSkillPath(args)}. Install the native Cursor copy only if you explicitly want the .cursor/skills path instead.`
      )}\n`
    );
  }
  io.write(`${ui.note(getDefaultExecPathLine())}\n`);
  io.write(`${ui.note(getHookBetaLine())}\n`);
  io.write(`${ui.note(`Shared guide: ${guideStatus}`)}\n`);
  io.write(`${ui.note(`Read ${guideReference} for the full workflow.`)}\n`);
  io.write(`${ui.note("The skill complements the CLI and managed block. It does not replace them.")}\n`);
  io.write(`${ui.note("sift only updates or removes SKILL.md when the file is clearly owned by sift.")}\n`);
  io.write(`  ${ui.command("sift exec --preset test-status -- pytest -q")}\n`);
  io.write(`  ${ui.command("sift doctor")}\n`);
  io.write(`${ui.note("Use --raw to print the exact SKILL.md content.")}\n`);
}

export async function installSkill(args: SkillInstallArgs): Promise<number> {
  const io = args.io ?? createTerminalIO();
  const targetPath = resolveSkillTargetPath(args);
  const scope = args.scope ?? "repo";
  const mode = inferOperationMode(args);
  const guidePath = resolveSharedGuideTargetPath({
    scope,
    cwd: args.cwd,
    homeDir: args.homeDir
  });
  const guideReference = getSharedGuideReference(scope);
  const content = `${renderSkillForRuntime(args.runtime, mode, guideReference)}\n`;
  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const existingContent = readOptionalSkillFile(targetPath);
  const ownership = inspectSkillOwnership(existingContent, args.runtime);
  const guideOwnership = inspectSharedGuideOwnership(readOptionalSharedGuide(guidePath));
  const compatibleCodexOwnership = inspectCompatibleCodexOwnership(args);
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

    io.write(
      `${ui.section(`Dry run: ${action === "update" ? "update" : "create"} ${getSkillTitle(args.runtime)} skill`)}\n`
    );
    io.write(`${ui.labelValue("scope", scope)}\n`);
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
    io.write(`${ui.note(getSkillInstallNote(args.runtime))}\n`);
    io.write(
      `${ui.labelValue(
        "shared guide",
        guideOwnership === "missing"
          ? `create ${guidePath}`
          : guideOwnership === "custom"
            ? `custom guide present; install would stop before overwriting ${guidePath}`
            : `update ${guidePath}`
      )}\n`
    );
    if (args.runtime === "cursor" && (compatibleCodexOwnership === "managed" || compatibleCodexOwnership === "legacy-managed")) {
      io.write(
        `${ui.warning(
          `Cursor already loads the compatible Codex skill at ${getCompatibleCodexSkillPath(args)}. Installing a second native Cursor skill would duplicate the same discoverability surface.`
        )}\n`
      );
    }
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

  if (args.runtime === "cursor" && (compatibleCodexOwnership === "managed" || compatibleCodexOwnership === "legacy-managed")) {
    io.error(
      `Refusing to install a duplicate native Cursor skill because Cursor already loads the compatible Codex skill at ${getCompatibleCodexSkillPath(args)}.\n`
    );
    return 1;
  }

  if (guideOwnership === "custom") {
    io.error(`Refusing to overwrite a custom SIFT.md at ${guidePath}. Move it, remove it manually, or choose a different scope.\n`);
    return 1;
  }

  writeSharedGuide(guidePath);
  writeTextFileAtomic(targetPath, content);
  io.write(`${ui.success(`${getSkillTitle(args.runtime)} skill ${action === "update" ? "updated" : "installed"}.`)}\n`);
  io.write(`${ui.labelValue("target", targetPath)}\n`);
  io.write(`${ui.labelValue("shared guide", guidePath)}\n`);
  return 0;
}

export async function removeSkill(args: SkillRemoveArgs): Promise<number> {
  const io = args.io ?? createTerminalIO();
  const targetPath = resolveSkillTargetPath(args);
  const scope = args.scope ?? "repo";
  const guidePath = resolveSharedGuideTargetPath({
    scope,
    cwd: args.cwd,
    homeDir: args.homeDir
  });
  const ui = createPresentation(Boolean(io.stdoutIsTTY));
  const existingContent = readOptionalSkillFile(targetPath);
  const ownership = inspectSkillOwnership(existingContent, args.runtime);

  if (args.dryRun) {
    io.write(`${ui.section(`Dry run: remove ${getSkillTitle(args.runtime)} skill`)}\n`);
    io.write(`${ui.labelValue("target", targetPath)}\n`);
    io.write(`${ui.labelValue("shared guide", guidePath)}\n`);
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
    io.write(`${ui.note(`No ${getSkillTitle(args.runtime)} skill found at the target path.`)}\n`);
    return 0;
  }

  if (ownership === "custom") {
    io.error(`Refusing to remove a custom SKILL.md at ${targetPath} because it is not clearly owned by sift.\n`);
    return 1;
  }

  fs.unlinkSync(targetPath);
  cleanupEmptyDirectories(args.runtime, path.dirname(targetPath), scope, args.cwd, args.homeDir);
  const sharedGuideRemoval = removeSharedGuideIfUnused({
    scope,
    cwd: args.cwd,
    homeDir: args.homeDir
  });
  io.write(`${ui.success(`${getSkillTitle(args.runtime)} skill removed.`)}\n`);
  if (sharedGuideRemoval.removed) {
    io.write(`${ui.note(`Removed the shared SIFT guide at ${sharedGuideRemoval.targetPath}`)}\n`);
  }
  return 0;
}

function cleanupEmptyDirectories(
  runtime: SkillRuntime,
  startDir: string,
  scope: SkillScope,
  cwd?: string,
  homeDir?: string
): void {
  const stopDir =
    scope === "global"
      ? path.join(homeDir ?? os.homedir(), runtime === "codex" ? ".codex" : ".cursor")
      : path.resolve(cwd ?? process.cwd(), runtime === "codex" ? ".codex" : ".cursor");

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
  for (const scope of ["repo", "global"] as const) {
    const guidePath = resolveSharedGuideTargetPath({
      scope,
      cwd: args.cwd,
      homeDir: args.homeDir
    });
    io.write(
      `${ui.labelValue(
        `${scope}Guide`,
        describeSharedGuideStatus(readOptionalSharedGuide(guidePath), guidePath)
      )}\n`
    );
  }
  for (const runtime of ["codex", "cursor"] as const) {
    const repoPath = resolveSkillTargetPath({ runtime, scope: "repo", cwd: args.cwd });
    const globalPath = resolveSkillTargetPath({
      runtime,
      scope: "global",
      homeDir: args.homeDir
    });
    const repoStatus = describeSkillStatus(readOptionalSkillFile(repoPath), repoPath, runtime);
    const globalStatus = describeSkillStatus(readOptionalSkillFile(globalPath), globalPath, runtime);

    io.write(`${ui.section(`${getSkillTitle(runtime)} skill status`)}\n`);
    io.write(`${ui.labelValue("repo", repoStatus)}\n`);
    io.write(`${ui.labelValue("global", globalStatus)}\n`);
    if (runtime === "cursor") {
      const compatibleRepo = describeSkillStatus(
        readOptionalSkillFile(getCompatibleCodexSkillPath({ scope: "repo", cwd: args.cwd })),
        getCompatibleCodexSkillPath({ scope: "repo", cwd: args.cwd }),
        "codex"
      );
      const compatibleGlobal = describeSkillStatus(
        readOptionalSkillFile(getCompatibleCodexSkillPath({ scope: "global", homeDir: args.homeDir })),
        getCompatibleCodexSkillPath({ scope: "global", homeDir: args.homeDir }),
        "codex"
      );
      io.write(`${ui.labelValue("compatibleCodexRepo", compatibleRepo)}\n`);
      io.write(`${ui.labelValue("compatibleCodexGlobal", compatibleGlobal)}\n`);
    }
  }
}

export function inspectSkillOwnership(
  content: string | undefined,
  runtime: SkillRuntime
): SkillOwnershipState {
  if (content === undefined) {
    return "missing";
  }

  if (content.includes(getSkillMarker(runtime))) {
    return "managed";
  }

  if (
    content.includes("name: sift") &&
    content.includes("## Decision Table") &&
    content.includes(getSkillOwnerNote(runtime))
  ) {
    return "legacy-managed";
  }

  return "custom";
}

export function describeSkillStatus(
  content: string | undefined,
  targetPath: string,
  runtime: SkillRuntime
): string {
  const ownership = inspectSkillOwnership(content, runtime);

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
