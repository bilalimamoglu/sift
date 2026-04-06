import type { OperationMode } from "../types.js";
import { getCompactPayloadIntro, getCompactWorkflowLines } from "./shared.js";

export const CURSOR_SKILL_MARKER = "<!-- sift:generated cursor-skill -->";

export function renderCursorSkill(mode: OperationMode, guideReference = "SIFT.md"): string {
  const intro = getCompactPayloadIntro(mode);

  return [
    "---",
    "name: sift",
    "description: Use when command output is long, noisy, and non-interactive so the agent can get a smaller first-pass diagnosis before reading raw logs.",
    "---",
    CURSOR_SKILL_MARKER,
    "",
    "# Sift",
    "",
    ...intro,
    "",
    ...getCompactWorkflowLines(guideReference),
    "",
    "## Notes",
    "",
    "- The CLI is the product runtime. This skill is a tiny Cursor-native pointer, not a second runtime.",
    "- Use this native `.cursor/skills` path when you want an explicit Cursor-owned surface instead of relying on compatibility loading from `.codex/skills`."
  ].join("\n");
}
