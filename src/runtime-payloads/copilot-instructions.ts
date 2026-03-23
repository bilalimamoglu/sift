export const COPILOT_INSTRUCTIONS_MARKER = "<!-- sift:generated copilot-instructions -->";

export function renderCopilotInstructions(): string {
  return [
    COPILOT_INSTRUCTIONS_MARKER,
    "",
    "# Sift",
    "",
    "Use `sift` as the first pass when command output is long, noisy, and non-interactive.",
    "The goal is to turn failure walls into grouped issues, likely root causes, and the next useful step before reading raw logs.",
    "",
    "## Repository Guidance",
    "",
    "- Start with `sift exec` before reading raw logs when the output is long or noisy.",
    "- For test failure walls, prefer `sift exec --preset test-status -- <test command>` first.",
    "- If `standard` already shows the root cause, stop there and read the relevant source instead of chasing more output.",
    "- After a fix, use `sift rerun` to refresh the same test suite and confirm what changed.",
    "- Keep edits focused and update tests when behavior changes.",
    "- Prefer the existing repo conventions in nearby code before introducing new patterns.",
    "- Keep generated sift-owned files intact; do not hand-edit them unless you are intentionally changing the generator.",
    "- Run `npm test` and `npm run typecheck` before handing off code changes.",
    "",
    "## Notes",
    "",
    "- This repository uses `sift` as the CLI runtime and `copilot-instructions.md` as a repo-wide guidance surface for Copilot.",
    "- The instructions are intentionally short so they stay useful instead of becoming another wall of text."
  ].join("\n");
}
