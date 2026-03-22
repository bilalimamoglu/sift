<!-- sift:begin codex -->
Use `sift` as the default local-first output guidance layer for long, noisy, non-interactive command output.
The goal is to turn failure walls into grouped issues, likely root causes, and the next useful step before reading raw logs.

Start with:
- `sift exec "question" -- <command> [args...]`
- `sift exec --preset test-status -- <test command>`
- `sift exec --preset audit-critical -- npm audit`
- `sift exec --preset infra-risk -- terraform plan`

When working inside the `sift` repo itself:
- For product-facing changes, read the relevant notes under `scripts/docs/product/` if they exist and the task touches product direction, onboarding, install flow, docs, or messaging.
- For install flow, onboarding, product copy, terminal interaction polish, or positioning work, consult the `gsd-product-visionary` lens first if available. If the runtime cannot spawn that exact registered agent, emulate the same skeptical, taste-driven product review before implementation.
- For install flow, setup flow, README getting-started, or other first-contact consumer surfaces, also consult the `gsd-first-user-tester` lens if available. If the runtime cannot spawn that exact registered agent, emulate a zero-context first-time user review before implementation.
- For marketing, launch planning, social posts, content repurposing, competitor analysis, or GitHub traction review, consult `gsd-marketing-strategist` first and save durable notes under `.planning/marketing/`.
- For auditing the marketing system itself, use `gsd-marketing-auditor` to critique gaps in tracking, platform memory, attribution, and review discipline.
- Preferred custom agent model defaults in this repo: `gsd-product-visionary` -> `gpt-5.4` with high reasoning, `gsd-first-user-tester` -> `gpt-5.4-mini` with low reasoning, `gsd-marketing-strategist` -> `gpt-5.4-mini` with medium reasoning, `gsd-marketing-auditor` -> `gpt-5.4` with high reasoning.
- When the runtime supports sub-agents, lightweight consumer-facing review passes should actually run on mini sub-agents instead of only being simulated as a lens in the main thread. Use the main `gpt-5.4` thread for final synthesis, tradeoff calls, and high-stakes product decisions after the lighter review agents report back.
- For first-contact copy surfaces such as README hero copy, installer one-liners, launch hooks, Reddit titles, Hacker News titles, and top-of-page product blurbs, treat the current positioning documents as a hard contract, not soft inspiration. Read `.planning/marketing/messaging/POSITIONING.md` and the relevant `scripts/docs/product/messaging/` notes before proposing final copy.
- On title-only or first-impression surfaces, do not rely on the body text or later comments to carry the category, core mechanism, or differentiation. Put the essential product truth in the title if reasonably possible.
- Before offering final first-contact copy, check that it still carries the current product truth: local-first, heuristics-first or fallback-only-when-needed, grouped failures or likely root causes, and the next useful step when space allows. If the copy drops the core product truth in favor of sounding clever, rewrite it.
- Do not bump `sift`'s version number unless the user explicitly asks for a release/version change. Release notes or changelog updates can be prepared when release-oriented work is requested, but version bumps are not automatic after large changes.
- Before pushing code from this repo, make sure the full expected verification surface is in good shape, not just the narrow local fix. That means being confident the relevant CI checks and release-facing pipelines would pass, or explicitly calling out what was not verified yet.
- Treat `npm run verify:release` as the default shared gate before pushing release-sensitive changes. It is the source-of-truth verification chain for CI parity and intentionally runs with CI-like npm wrapper noise enabled.
- Keep the tracked `.githooks/pre-push` hook healthy. It should default to `npm run verify:release:core` so the repo catches most publish-facing regressions before the push leaves the machine.
- For especially risky release or packaging work, prefer adding `npm run verify:release:clean` before push or publish so a temporary clean-room `npm ci` pass can catch warm-worktree blind spots.
- After a release lands, refresh the globally installed `sift` from this repo with `npm install -g .` and confirm `sift --version` matches `package.json` before treating the global binary as trustworthy again.
- When verifying new `sift` CLI behavior, prefer the repo-local entrypoint (`node --import tsx src/cli.ts ...` or the built local package) unless you have already confirmed the globally installed `sift` version matches `package.json`.
- If global and local `sift` versions differ, treat repo-local results as source of truth for development verification.
- If `sift` is insufficient or says the signal is not enough while developing `sift` itself, append a short timestamped note to `.local/agent-insufficient-log.md` with the command, preset or question, likely cause, and next step, then keep trying to resolve the gap instead of stopping at the first insufficient result.
- Even if internal planning, GSD artifacts, and implementation reasoning happen in English, explain progress, outcomes, why the work was needed, and the next plan back to the user in simple, detailed Turkish by default.

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
- `sift rerun --remaining` narrows automatically for `pytest` and reruns the full original command for `vitest` and `jest` while keeping the diagnosis focused on what still fails.
- For other runners, rerun a narrowed command manually with `sift exec --preset test-status -- <narrowed test command>` if you need a smaller surface.
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
