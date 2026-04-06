import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getDefaultClaudeGlobalCommandsDir,
  getDefaultClaudeGlobalInstructionsPath,
  getDefaultCodexGlobalInstructionsPath,
  getDefaultCodexGlobalSkillPath,
  getDefaultCursorGlobalSkillPath,
  getDefaultGlobalGuidePath
} from "./constants.js";
import { CLAUDE_COMMAND_NAMES, getClaudeCommandMarker } from "./runtime-payloads/claude-commands.js";
import { CODEX_SKILL_MARKER } from "./runtime-payloads/codex-skill.js";
import { CURSOR_SKILL_MARKER } from "./runtime-payloads/cursor-skill.js";
import { renderSharedGuideBody } from "./runtime-payloads/shared.js";

export const SHARED_GUIDE_MARKER = "<!-- sift:generated shared-guide -->";

export type SharedGuideScope = "repo" | "global";
export type SharedGuideOwnership = "managed" | "missing" | "custom";

export function resolveSharedGuideTargetPath(args: {
  scope?: SharedGuideScope;
  cwd?: string;
  homeDir?: string;
}): string {
  const scope = args.scope ?? "repo";

  if (scope === "global") {
    return getDefaultGlobalGuidePath(args.homeDir ?? os.homedir());
  }

  return path.resolve(args.cwd ?? process.cwd(), "SIFT.md");
}

export function getSharedGuideReference(scope: SharedGuideScope): string {
  return scope === "global" ? "~/.config/sift/SIFT.md" : "SIFT.md";
}

export function renderSharedGuide(): string {
  return [SHARED_GUIDE_MARKER, renderSharedGuideBody()].join("\n");
}

export function inspectSharedGuideOwnership(
  content: string | undefined
): SharedGuideOwnership {
  if (content === undefined) {
    return "missing";
  }

  return content.includes(SHARED_GUIDE_MARKER) ? "managed" : "custom";
}

export function describeSharedGuideStatus(
  content: string | undefined,
  targetPath: string
): string {
  const ownership = inspectSharedGuideOwnership(content);

  if (ownership === "missing") {
    return `not installed (${targetPath})`;
  }

  if (ownership === "custom") {
    return `custom file present (${targetPath})`;
  }

  return `installed (${targetPath})`;
}

export function readOptionalSharedGuide(targetPath: string): string | undefined {
  if (!fs.existsSync(targetPath)) {
    return undefined;
  }

  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error(`${targetPath} exists but is not a file.`);
  }

  return fs.readFileSync(targetPath, "utf8");
}

export function scopeHasSharedGuideDependents(args: {
  scope?: SharedGuideScope;
  cwd?: string;
  homeDir?: string;
}): boolean {
  const scope = args.scope ?? "repo";
  const cwd = args.cwd ?? process.cwd();
  const homeDir = args.homeDir ?? os.homedir();
  const codexInstructionsPath =
    scope === "global"
      ? getDefaultCodexGlobalInstructionsPath(homeDir)
      : path.resolve(cwd, "AGENTS.md");
  const claudeInstructionsPath =
    scope === "global"
      ? getDefaultClaudeGlobalInstructionsPath(homeDir)
      : path.resolve(cwd, "CLAUDE.md");
  const codexSkillPath =
    scope === "global"
      ? getDefaultCodexGlobalSkillPath(homeDir)
      : path.resolve(cwd, ".codex", "skills", "sift", "SKILL.md");
  const cursorSkillPath =
    scope === "global"
      ? getDefaultCursorGlobalSkillPath(homeDir)
      : path.resolve(cwd, ".cursor", "skills", "sift", "SKILL.md");
  const claudeCommandDir =
    scope === "global"
      ? getDefaultClaudeGlobalCommandsDir(homeDir)
      : path.resolve(cwd, ".claude", "commands", "sift");

  return (
    hasManagedAgentBlock(readOptionalSharedGuide(codexInstructionsPath), "codex") ||
    hasManagedAgentBlock(readOptionalSharedGuide(claudeInstructionsPath), "claude") ||
    readOptionalSharedGuide(codexSkillPath)?.includes(CODEX_SKILL_MARKER) === true ||
    readOptionalSharedGuide(cursorSkillPath)?.includes(CURSOR_SKILL_MARKER) === true ||
    CLAUDE_COMMAND_NAMES.some((name) =>
      readOptionalSharedGuide(path.join(claudeCommandDir, `${name}.md`))?.includes(
        getClaudeCommandMarker(name)
      ) === true
    )
  );
}

export function writeSharedGuide(targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${renderSharedGuide()}\n`, "utf8");
  fs.renameSync(tempPath, targetPath);
}

export function removeSharedGuideIfUnused(args: {
  scope?: SharedGuideScope;
  cwd?: string;
  homeDir?: string;
}): { targetPath: string; removed: boolean } {
  const targetPath = resolveSharedGuideTargetPath(args);
  const ownership = inspectSharedGuideOwnership(readOptionalSharedGuide(targetPath));

  if (ownership !== "managed" || scopeHasSharedGuideDependents(args)) {
    return { targetPath, removed: false };
  }

  fs.unlinkSync(targetPath);
  return { targetPath, removed: true };
}

function hasManagedAgentBlock(
  content: string | undefined,
  agent: "codex" | "claude"
): boolean {
  if (!content) {
    return false;
  }

  return (
    content.includes(`<!-- sift:begin ${agent} -->`) &&
    content.includes(`<!-- sift:end ${agent} -->`)
  );
}
