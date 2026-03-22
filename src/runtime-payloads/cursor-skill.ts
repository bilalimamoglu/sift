import type { OperationMode } from "../types.js";
import { getSharedPayloadIntro } from "./shared.js";

export const CURSOR_SKILL_MARKER = "<!-- sift:generated cursor-skill -->";

export function renderCursorSkill(mode: OperationMode): string {
  const intro = getSharedPayloadIntro(mode);

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
    "## Decision Table",
    "",
    "- Long noisy output: use `sift exec` first.",
    "- Exact raw output required: skip `sift` and read the raw output directly.",
    "- Test debugging: start with `sift exec --preset test-status -- <test command>`.",
    "- If `standard` says stop and act: stop there and read source before chasing more logs.",
    "- If `standard` says zoom or still contains an unknown bucket: use `sift escalate` once before raw.",
    "- After a fix: use `sift rerun` to refresh the same full suite at standard.",
    "- Hook beta: inspect `sift hook match -- <command>` first; treat it as optional, not the default path.",
    "",
    "## Commands",
    "",
    "- `sift exec --preset test-status -- pytest -q`",
    "- `sift exec --preset typecheck-summary -- npm run typecheck`",
    "- `sift exec --preset lint-failures -- npm run lint`",
    "- `sift exec --preset audit-critical -- npm audit`",
    "- `sift exec --preset infra-risk -- terraform plan`",
    "- `sift rerun`",
    "- `sift escalate`",
    "",
    "## Notes",
    "",
    "- Prefer text output first. Diagnose JSON is for automation or machine branching.",
    "- The CLI is the product runtime. This skill is a discoverability and workflow guide for Cursor.",
    "- Use this native `.cursor/skills` path when you want an explicit Cursor-owned surface instead of relying on compatibility loading from `.codex/skills`."
  ].join("\n");
}
