import type { OperationMode } from "../types.js";
import { getCompactPayloadIntro, getCompactWorkflowLines } from "./shared.js";

export const CODEX_SKILL_MARKER = "<!-- sift:generated codex-skill -->";

export function renderCodexSkill(mode: OperationMode, guideReference = "SIFT.md"): string {
  const intro = getCompactPayloadIntro(mode);

  return [
    "---",
    "name: sift",
    "description: Use when command output is long, noisy, and non-interactive so the agent can get a smaller first-pass diagnosis before reading raw logs.",
    "---",
    CODEX_SKILL_MARKER,
    "",
    "# Sift",
    "",
    ...intro,
    "",
    ...getCompactWorkflowLines(guideReference),
    "",
    "## Notes",
    "",
    "- The CLI is the product runtime. This skill is a tiny Codex-native pointer, not a second runtime."
  ].join("\n");
}
