import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_CONFIG_FILENAME = "sift.config.yaml";

export function getDefaultCodexGlobalInstructionsPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".codex", "AGENTS.md");
}

export function getDefaultClaudeGlobalInstructionsPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".claude", "CLAUDE.md");
}

export function getDefaultGlobalConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "sift", "config.yaml");
}

export function getDefaultGlobalStateDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "sift", "state");
}

export function getDefaultTestStatusStatePath(homeDir = os.homedir()): string {
  return path.join(getDefaultGlobalStateDir(homeDir), "last-test-status.json");
}

export function getDefaultScopedTestStatusStateDir(homeDir = os.homedir()): string {
  return path.join(getDefaultGlobalStateDir(homeDir), "test-status", "by-cwd");
}

export function getScopedTestStatusStatePath(cwd: string, homeDir = os.homedir()): string {
  const normalizedCwd = normalizeScopedCacheCwd(cwd);
  const baseName = slugCachePathSegment(path.basename(normalizedCwd)) || "root";
  const shortHash = crypto.createHash("sha256").update(normalizedCwd).digest("hex").slice(0, 10);
  return path.join(getDefaultScopedTestStatusStateDir(homeDir), `${baseName}-${shortHash}.json`);
}

function slugCachePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeScopedCacheCwd(cwd: string): string {
  const absoluteCwd = path.resolve(cwd);

  try {
    return fs.realpathSync.native(absoluteCwd);
  } catch {
    return absoluteCwd;
  }
}

export function getDefaultConfigSearchPaths(): string[] {
  return [
    path.resolve(process.cwd(), "sift.config.yaml"),
    path.resolve(process.cwd(), "sift.config.yml"),
    getDefaultGlobalConfigPath(),
    path.join(os.homedir(), ".config", "sift", "config.yml")
  ];
}

export const INSUFFICIENT_SIGNAL_TEXT = "Insufficient signal in the provided input.";

export const GENERIC_JSON_CONTRACT =
  '{"answer":string,"evidence":string[],"risks":string[]}';

export const CAPTURE_OMITTED_MARKER = "\n...[captured output omitted]...\n";
