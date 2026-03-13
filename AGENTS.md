<!-- sift:begin codex -->
Use `sift` as the default reduction layer for long, noisy, non-interactive command output.
The goal is to shrink that output before it spends context-window and token budget in the model.

Start with:
- `sift exec "question" -- <command> [args...]`
- `sift exec --preset test-status -- <test command>`
- `sift watch "what changed between cycles?" < watcher-output.txt`
- `sift exec --watch "what changed between cycles?" -- <command> [args...]`
- `sift exec --preset audit-critical -- npm audit`
- `sift exec --preset infra-risk -- terraform plan`

When debugging test failures, default to `sift` first and treat `standard` as the usual stop point:
- Run the full suite first: `sift exec --preset test-status -- <test command>`
- Think of `standard` as the map, `rerun --remaining` as the zoom lens, and raw traceback as the last resort.
- If `standard` ends with `Decision: stop and act`, stop there unless you truly need exact traceback lines.
- If `standard` already shows the main failure buckets, counts, and actionable hints, stop there and go read source or inspect the relevant tests or app code.
- Use `sift escalate` when you want a deeper render of the same cached output without rerunning the command.
- `sift escalate` and `sift rerun` require a cached `sift exec --preset test-status -- <test command>` run first.
- After making or planning a fix, refresh the truth with `sift rerun` so the same full suite runs again at `standard` and shows what is resolved or still remaining.
- The normal stop budget is `standard` first, then at most one zoom step before raw.
- Only if more detail is still needed after `sift rerun`, use `sift rerun --remaining --detail focused`, then `sift rerun --remaining --detail verbose`, then `sift rerun --remaining --detail verbose --show-raw`.
- `sift rerun --remaining` currently supports only argv-mode `pytest ...` or `python -m pytest ...` runs; otherwise rerun a narrowed command manually with `sift exec --preset test-status -- <narrowed pytest command>`.
- Start with `standard` text. Use diagnose JSON only when automation or machine branching truly needs it.
- If `standard` already shows bucket-level root cause, anchor, and fix lines, trust it and report from it directly.
- In that case, do not re-verify the same bucket with raw pytest; at most do one targeted source read before you edit.
- If `standard` still contains an unknown bucket or ends with `Decision: zoom`, do one deeper sift pass before raw traceback.
- If you need a machine-readable diagnosis, use `sift exec --preset test-status --goal diagnose --format json -- <test command>` or the same shape with `sift rerun` / `sift watch --preset test-status`.
- Diagnose JSON is summary-first by default. Add `--include-test-ids` only when you truly need the raw failing test IDs.
- If diagnose JSON returns `read_targets.context_hint.start_line/end_line`, read only that small line range first.
- If diagnose JSON returns only `read_targets.context_hint.search_hint`, search for that string in the target file before reading the whole file.
- If output redraws or repeats across cycles, use `sift watch ...` or `sift exec --watch ...` before manually diffing raw logs.
- Run the raw test command only if you still need exact traceback lines after the sift pass is still insufficient.

Use pipe mode only when output already exists.

Do not use `sift` when:
- exact raw output is already known to be required
- the command is interactive or TUI-based
- the output is already short and clear
- shell control flow depends on raw output semantics

Assume credentials come from shell environment or `sift.config.yaml`.
Do not pass API keys inline.
<!-- sift:end codex -->
