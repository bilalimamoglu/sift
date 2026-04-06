import {
  describeInsufficientBehavior,
  describeOperationMode,
  getOperationModeLabel
} from "../config/operation-mode.js";
import {
  getDefaultExecPathLine,
  getExecVsHookDecisionLine,
  getHookBetaLine,
  getHookBetaPlainEnglishLine
} from "../content/adoption.js";
import type { OperationMode } from "../types.js";

export function getCompactPayloadIntro(mode: OperationMode): string[] {
  return [
    "Use `sift` as the default local-first output guidance layer for long, noisy, non-interactive command output.",
    "",
    `Default operating mode: ${getOperationModeLabel(mode)}.`,
    describeOperationMode(mode),
    describeInsufficientBehavior(mode)
  ];
}

export function getCompactWorkflowLines(guideReference: string): string[] {
  return [
    "",
    "Use `sift exec` first for long, noisy, non-interactive output.",
    "If exact raw output is required, skip `sift` and read the raw output directly.",
    "For test failures, start with `sift exec --preset test-status -- <test command>`.",
    `Read \`${guideReference}\` for the full workflow, rerun/escalate path, and diagnose JSON notes.`
  ];
}

export function renderSharedGuideBody(): string {
  return [...getSharedGuideIntro(), ...getSharedWorkflowLines()].join("\n");
}

function getSharedGuideIntro(): string[] {
  return [
    "# Sift Guide",
    "",
    "Use `sift` as the default local-first output guidance layer for long, noisy, non-interactive command output.",
    "The goal is to turn failure walls into grouped issues, likely root causes, and the next useful step before reading raw logs.",
    "",
    "This guide is mode-neutral. Your installed runtime surface and `sift doctor` show the active operation-mode details for the current setup.",
    "",
    getDefaultExecPathLine(),
    getHookBetaLine(),
    getExecVsHookDecisionLine(),
    getHookBetaPlainEnglishLine()
  ];
}

function getSharedWorkflowLines(): string[] {
  return [
    "",
    "Start with:",
    '- `sift exec \"question\" -- <command> [args...]`',
    "- `sift exec --preset test-status -- <test command>`",
    "- `sift exec --preset audit-critical -- npm audit`",
    "- `sift exec --preset infra-risk -- terraform plan`",
    "",
    "When debugging test failures, default to `sift` first and treat `standard` as the usual stop point:",
    "- Run the full suite first: `sift exec --preset test-status -- <test command>`",
    "- Think of `standard` as the map, `rerun --remaining` as the zoom lens, and raw traceback as the last resort.",
    "- If `standard` ends with `Decision: stop and act`, stop there unless you truly need exact traceback lines.",
    "- If `standard` already shows the main failure buckets, counts, and actionable hints, stop there and go read source or inspect the relevant tests or app code.",
    "- Use `sift escalate` when you want a deeper render of the same cached output without rerunning the command.",
    "- `sift escalate` and `sift rerun` require a cached `sift exec --preset test-status -- <test command>` run first.",
    "- After making or planning a fix, refresh the truth with `sift rerun` so the same full suite runs again at `standard` and shows what is resolved or still remaining.",
    "- The normal stop budget is `standard` first, then at most one zoom step before raw.",
    "- Only if more detail is still needed after `sift rerun`, use `sift rerun --remaining --detail focused`, then `sift rerun --remaining --detail verbose`, then `sift rerun --remaining --detail verbose --show-raw`.",
    "- `sift rerun --remaining` narrows automatically for `pytest` and reruns the full original command for `vitest` and `jest` while keeping the diagnosis focused on what still fails.",
    "- For other runners, rerun a narrowed command manually with `sift exec --preset test-status -- <narrowed test command>` if you need a smaller surface.",
    "- Start with `standard` text. Use diagnose JSON only when automation or machine branching truly needs it.",
    "- If `standard` already shows bucket-level root cause, anchor, and fix lines, trust it and report from it directly.",
    "- In that case, do not re-verify the same bucket with raw pytest; at most do one targeted source read before you edit.",
    "- If `standard` still contains an unknown bucket or ends with `Decision: zoom`, do one deeper sift pass before raw traceback.",
    "- If you need a machine-readable diagnosis, use `sift exec --preset test-status --goal diagnose --format json -- <test command>` or the same shape with `sift rerun` / `sift watch --preset test-status`.",
    "- Diagnose JSON is summary-first by default. Add `--include-test-ids` only when you truly need the raw failing test IDs.",
    "- If diagnose JSON returns `read_targets.anchor_kind=traceback` and `read_targets.context_hint.kind=exact_window`, read only that small line range first.",
    "- If diagnose JSON returns `read_targets.context_hint.kind=search_only`, search for `read_targets.context_hint.search_hint` before reading the whole file.",
    "- Treat lower-confidence or non-traceback read targets as representative hints, not exact root-cause proof.",
    "- If output redraws or repeats across cycles, use `sift watch ...` or `sift exec --watch ...` before manually diffing raw logs.",
    "- Run the raw test command only if you still need exact traceback lines after the sift pass is still insufficient.",
    "",
    "Use pipe mode only when output already exists.",
    "",
    "Do not use `sift` when:",
    "- exact raw output is already known to be required",
    "- the command is interactive or TUI-based",
    "- the output is already short and clear",
    "- shell control flow depends on raw output semantics",
    "",
    "Assume credentials come from shell environment or `sift.config.yaml`.",
    "Do not pass API keys inline."
  ];
}
