import type { OperationMode } from "../types.js";
import { getSharedPayloadIntro } from "./shared.js";

export const CLAUDE_COMMAND_NAMES = ["help", "test-status", "doctor"] as const;
export type ClaudeCommandName = (typeof CLAUDE_COMMAND_NAMES)[number];

export function getClaudeCommandMarker(name: ClaudeCommandName): string {
  return `<!-- sift:generated claude-command ${name} -->`;
}

export function renderClaudeCommandPack(
  mode: OperationMode
): Record<`${ClaudeCommandName}.md`, string> {
  return {
    "help.md": renderClaudeHelpCommand(mode),
    "test-status.md": renderClaudeTestStatusCommand(mode),
    "doctor.md": renderClaudeDoctorCommand(mode)
  };
}

function renderClaudeHelpCommand(mode: OperationMode): string {
  const intro = getSharedPayloadIntro(mode);

  return [
    getClaudeCommandMarker("help"),
    "# /sift:help",
    "",
    ...intro,
    "",
    "Use this command when you want the shortest honest reminder of the normal `sift` workflow inside Claude.",
    "",
    "## Default Path",
    "",
    "- Use `sift exec` first when output is long, noisy, and non-interactive.",
    "- Use the managed `CLAUDE.md` block as steering, not as a replacement for the CLI.",
    "- Hook beta is optional. Inspect `sift hook match -- <command>` before using it.",
    "",
    "## Useful Commands",
    "",
    "- `sift exec --preset test-status -- pytest -q`",
    "- `sift exec --preset typecheck-summary -- npm run typecheck`",
    "- `sift exec --preset lint-failures -- npm run lint`",
    "- `sift doctor`",
    "",
    "## Notes",
    "",
    "- The CLI is still the real runtime. These Claude commands are tiny native entry points, not a second execution system."
  ].join("\n");
}

function renderClaudeTestStatusCommand(mode: OperationMode): string {
  const intro = getSharedPayloadIntro(mode);

  return [
    getClaudeCommandMarker("test-status"),
    "# /sift:test-status",
    "",
    ...intro,
    "",
    "Use this when Claude is about to read a large test failure wall.",
    "",
    "## Run",
    "",
    "- `sift exec --preset test-status -- <test command>`",
    "",
    "## Stop Budget",
    "",
    "- Start at `standard` and stop there if it already shows the main failure buckets, likely root cause, and next useful step.",
    "- If the result still says zoom or contains an unknown bucket, use `sift escalate` once before reading raw output.",
    "- After a fix, use `sift rerun` to refresh the same suite at `standard`.",
    "- Only fall back to exact raw traceback lines if the focused `sift` path is still insufficient.",
    "",
    "## Examples",
    "",
    "- `sift exec --preset test-status -- pytest -q`",
    "- `sift exec --preset test-status -- npx vitest run`",
    "- `sift exec --preset test-status -- npx jest`"
  ].join("\n");
}

function renderClaudeDoctorCommand(mode: OperationMode): string {
  const intro = getSharedPayloadIntro(mode);

  return [
    getClaudeCommandMarker("doctor"),
    "# /sift:doctor",
    "",
    ...intro,
    "",
    "Use this when you want to verify the current setup, operation mode, and first suggested next step before reducing another command.",
    "",
    "## Run",
    "",
    "- `sift doctor`",
    "",
    "## Why",
    "",
    "- It tells you whether `sift` is configured, what operation mode is active, and whether provider-assisted fallback is actually available.",
    "- It is the fastest way to sanity-check install state before assuming a runtime issue."
  ].join("\n");
}
