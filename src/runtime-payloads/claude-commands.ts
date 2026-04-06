import type { OperationMode } from "../types.js";
import { getCompactPayloadIntro } from "./shared.js";

export const CLAUDE_COMMAND_NAMES = ["help", "test-status", "doctor"] as const;
export type ClaudeCommandName = (typeof CLAUDE_COMMAND_NAMES)[number];

export function getClaudeCommandMarker(name: ClaudeCommandName): string {
  return `<!-- sift:generated claude-command ${name} -->`;
}

export function renderClaudeCommandPack(
  mode: OperationMode,
  guideReference = "SIFT.md"
): Record<`${ClaudeCommandName}.md`, string> {
  return {
    "help.md": renderClaudeHelpCommand(mode, guideReference),
    "test-status.md": renderClaudeTestStatusCommand(mode, guideReference),
    "doctor.md": renderClaudeDoctorCommand(mode, guideReference)
  };
}

function renderClaudeHelpCommand(mode: OperationMode, guideReference: string): string {
  const intro = getCompactPayloadIntro(mode);

  return [
    getClaudeCommandMarker("help"),
    "# /sift:help",
    "",
    ...intro,
    "",
    "Use `sift exec` first when output is long, noisy, and non-interactive.",
    "If exact raw output is required, skip `sift` and read the raw output directly.",
    `Read \`${guideReference}\` for the full workflow.`
  ].join("\n");
}

function renderClaudeTestStatusCommand(mode: OperationMode, guideReference: string): string {
  const intro = getCompactPayloadIntro(mode);

  return [
    getClaudeCommandMarker("test-status"),
    "# /sift:test-status",
    "",
    ...intro,
    "",
    "For test failures, start with `sift exec --preset test-status -- <test command>`.",
    `Read \`${guideReference}\` for the stop budget, rerun path, and raw-output fallback rules.`
  ].join("\n");
}

function renderClaudeDoctorCommand(mode: OperationMode, guideReference: string): string {
  const intro = getCompactPayloadIntro(mode);

  return [
    getClaudeCommandMarker("doctor"),
    "# /sift:doctor",
    "",
    ...intro,
    "",
    "Run `sift doctor` to verify the current setup before reducing another command.",
    `Read \`${guideReference}\` for the full command workflow after setup is confirmed.`
  ].join("\n");
}
