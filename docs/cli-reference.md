# CLI Reference

This page covers the useful `sift` commands that do not need to dominate the main README.

The main README is product-first. This page is command-first.

If you are new, ignore the lower-level surfaces for now and start with `sift exec --preset test-status -- <test command>`.

## Core commands

### `sift exec`

Run a command, capture its output, and turn noisy results into a smaller, more actionable first pass while preserving the child exit code.

This is the default product path.
Use it when you want explicit control, a freeform question, an exact preset choice, or the cached `rerun` / `escalate` test workflow.

```bash
sift exec --preset test-status -- pytest -q
sift exec "what changed?" -- git diff
sift exec --preset audit-critical --fail-on -- npm audit
```

Useful flags:
- `--dry-run`
- `--show-raw`
- `--fail-on`
- `--watch`
- `--goal diagnose --format json`

### `sift hook match`

Inspect whether the opt-in hook beta would match a command to a known preset.

This is intentionally narrow:
- known preset categories only
- unknown commands pass through untouched
- path-prefixed binaries stay out of scope for the beta matcher

```bash
sift hook match -- pytest -q
sift hook match --shell "terraform plan"
```

### `sift hook run`

Run a command through the opt-in hook beta.

This is an optional shortcut, not the main workflow.
Use it only when you want less typing for a tiny known command set and you are happy for `sift` to pick the preset.

Current contract:
- beta only
- known preset matches only
- unknown commands run unchanged
- if the hook path fails internally, `sift` falls back to the raw command
- if suspicious instruction-like log lines appear, `sift` de-emphasizes them before reduction instead of treating them as trusted next-step guidance

```bash
sift hook run -- pytest -q
sift hook run --shell "npm audit --json"
```

### `sift rerun`

Rerun the cached `test-status` command after a fix.

```bash
sift rerun
sift rerun --remaining --detail focused
sift rerun --remaining --detail verbose --show-raw
```

Notes:
- `sift rerun` reruns the cached full command at standard detail.
- `sift rerun --remaining` narrows automatically for cached `pytest` runs.
- For cached `vitest` and `jest` runs, `sift rerun --remaining` reruns the original full command and keeps the result focused on what still fails relative to the cached baseline.
- The cached `test-status` baseline is project-scoped and stored under `~/.config/sift/state/test-status/by-cwd/`.
- That baseline is written by `sift exec --preset test-status -- <test command>` on normal non-watch runs for the command's working directory.
- `sift rerun` and `sift escalate` only read the cached baseline for the current working directory.
- If you want to start fresh for the current project, delete that project's cache entry under `~/.config/sift/state/test-status/by-cwd/` and run a new `sift exec --preset test-status -- <test command>`.

### `sift escalate`

Re-render the last cached `test-status` run without rerunning the child command.

```bash
sift escalate
sift escalate --detail verbose
sift escalate --show-raw
```

Use this when the cached first pass is close but you want one deeper render before going to raw logs.

### `sift watch`

Summarize repeated or redraw-style piped output as cycles.

```bash
sift watch "what changed between cycles?" < watcher-output.txt
sift watch --preset test-status < pytest-watch.txt
sift exec --watch "what changed between cycles?" -- node watcher.js
```

Use watch mode when output redraws or repeats over time.

## Pipe-mode commands

### `sift [question]`

Ask a freeform question about piped output.

```bash
git diff | sift "what changed?"
npm audit 2>&1 | sift "what are the critical issues?"
```

### `sift preset <name>`

Run a named preset directly against piped output.

```bash
pytest -q 2>&1 | sift preset test-status
npm audit 2>&1 | sift preset audit-critical
terraform plan 2>&1 | sift preset infra-risk
```

Use this when output already exists in a pipeline and you do not want `sift exec`.

## Config commands

### `sift config setup`

Interactive guided setup for choosing how you want to use `sift`, including provider-assisted fallback.

Mode summary:
- `agent-escalation`: use this if you already have Codex or Claude open. `sift` does the first pass, then the agent handles the weird leftovers.
- `provider-assisted`: use this if you want `sift` itself to ask a cheap fallback model when needed. This requires an API key.
- `local-only`: use this if `sift` is working alone and you want everything to stay local.

OpenAI setup defaults to `gpt-5-nano`. Guided setup also offers `gpt-5.4-nano` and `gpt-5-mini` as popular backup choices. OpenRouter setup defaults to `openrouter/free` and shows a few named free alternatives.

This command is still the main reconfiguration surface even though `sift install` now continues directly into provider setup when you pick `provider-assisted`.

```bash
sift config setup
```

### `sift config init`

Write a starter config file without the guided interactive flow.

```bash
sift config init
sift config init --config ./sift.config.yaml
```

### `sift config show`

Inspect the active config.

```bash
sift config show
sift config show --show-secrets
```

The config now includes a tiny `safety` section:
- `enabled`
- `extraRiskPatterns`
- `ignoredRiskPatterns`

These are substring hints for the hostile-output hardening pass. They are intentionally not a rules engine.

The config also includes a tiny `history` section:
- `enabled`
- `retentionDays`

This only controls local metadata history for `sift gain` and `sift discover`.

### `sift config validate`

Validate the current config or a specific config file.

```bash
sift config validate
sift config validate --config ./sift.config.yaml
```

### `sift config use`

Switch between saved providers.

```bash
sift config use openai
sift config use openrouter
```

## Inspection commands

### `sift doctor`

Check which config is active and how `sift` will behave in the current setup.

`sift doctor` should help you answer two practical questions:
- what is my default path right now?
- when, if ever, should I care about the hook beta shortcut?

```bash
sift doctor
```

### `sift gain`

Show local `sift` history in plain language.

This is a lightweight measurement surface, not a dashboard.
Use it when you want to check whether `sift` is actually reducing the size of what you feed into the agent.

```bash
sift gain
sift gain --today
sift gain --last 7 --by-preset
```

What it reports:
- recorded local runs
- rough size/token reduction estimates
- whether provider help was skipped
- which presets you use most

Important boundary:
- local history only
- metadata only, not raw logs
- token numbers are estimates unless the provider reported exact usage

If you want to wipe that local history:

```bash
sift gain clear --yes
```

### `sift discover`

Show evidence-backed missed-use hints from local `sift` history.

This command is intentionally conservative.
If your local history is thin or noisy, it stays quiet instead of inventing advice.

```bash
sift discover
sift discover --last 7
```

Current hint types are deliberately small:
- repeated command shapes that fit an existing built-in preset
- repeated explicit runs where checking the optional hook matcher may save typing

Notes:
- discover only speaks when local history is thick enough
- suggestions come from repeated observed patterns, not shell-wide telemetry
- if there is no convincing pattern yet, `sift discover` should say so

### `sift presets`

List presets or inspect a single preset.

```bash
sift presets list
sift presets show test-status
sift presets show infra-risk --internal
```

## Agent commands

### `sift install`

Run the guided runtime installer. This is the recommended entry point for first-time setup.

The installer now asks which operating mode matches your actual workflow:
- `agent-escalation`: best if a coding agent is already in the loop
- `provider-assisted`: best if you want API-backed cheap fallback inside `sift`
- `local-only`: best if you want `sift` by itself with no provider credentials

Supported runtime paths:
- `codex`: managed `AGENTS.md` plus tiny Codex skill
- `claude`: managed `CLAUDE.md` plus tiny Claude command pack
- `cursor`: tiny native `.cursor/skills/sift/SKILL.md` only

If you pick `provider-assisted`, the installer continues directly into provider/model/API-key setup instead of telling you to run `sift config setup` separately.

The install summary should leave you with one obvious default next step, then mention `sift hook match -- pytest -q` only as an optional beta shortcut for a known preset.

The installer also shows an explicit preflight:
- which guidance files it will write
- whether provider config is still machine-wide
- what it will not touch
- that custom skill/command files are not overwritten unless `sift` can prove ownership

```bash
sift install
sift install codex --scope global --yes
sift install cursor
sift install all --scope local --yes
```

### `sift agent install`

Install a managed instruction block for a supported agent directly. Use this when you want dry runs, raw block output, or a low-level override.

The low-level install also keeps the tiny native packaging honest:
- Codex installs update `AGENTS.md` and the generated `SKILL.md`
- Claude installs update `CLAUDE.md` and the generated `.claude/commands/sift/` command pack
- the CLI stays the real runtime; these files are guidance surfaces only

```bash
sift agent install codex
sift agent install claude
sift agent install codex --dry-run
sift agent install codex --dry-run --raw
```

### `sift agent show`

Preview the managed block without writing it.

```bash
sift agent show codex
sift agent show codex --raw
```

### `sift agent status`

Show whether managed blocks are installed.

```bash
sift agent status
```

### `sift agent remove`

Remove a previously installed managed block.

```bash
sift agent remove codex
sift agent remove claude
```

## Skill commands

### `sift skill show`

Preview the generated native `sift` skill without writing anything.

```bash
sift skill show codex
sift skill show cursor
sift skill show codex --raw
```

Use this when you want to inspect the tiny native workflow guide that reinforces the normal `sift exec` path.

### `sift skill install`

Install or update the generated native skill directly.

```bash
sift skill install codex --scope global --yes
sift skill install cursor --scope repo --yes
sift skill install codex --dry-run
```

This complements the CLI and managed block. It does not replace them.
If a custom `SKILL.md` is already present, `sift` refuses to overwrite it.
If a compatible Codex skill already exists in the same scope, `sift` refuses to install a duplicate native Cursor skill.

### `sift skill status`

Show whether the Codex and Cursor skills are installed in repo or global scope, or whether a custom `SKILL.md` is blocking ownership-safe updates.

```bash
sift skill status
```

### `sift skill remove`

Remove the generated Codex skill file.

If the target `SKILL.md` is not clearly owned by `sift`, removal is refused so custom content is not deleted by mistake.

```bash
sift skill remove codex --scope global --yes
```

## Diagnose JSON

Most users should start with text output. JSON is for automation and machine branching.

```bash
sift exec --preset test-status --goal diagnose --format json -- pytest -q
sift rerun --goal diagnose --format json
sift watch --preset test-status --goal diagnose --format json < pytest-watch.txt
```

Useful flags:
- `--include-test-ids` when you need full raw failing test IDs
- `--detail focused` or `--detail verbose` when supported by the flow

Read-target trust notes:
- `read_targets.anchor_kind=traceback` plus `read_targets.context_hint.kind=exact_window` is the strongest source-read hint
- `read_targets.context_hint.kind=search_only` means search first instead of trusting an exact line range
- lower-confidence or non-traceback read targets are representative hints, not exact root-cause proof

## Contract-drift preset

Use `contract-drift` only for explicit artifact mismatch surfaces such as:
- snapshot drift
- golden output drift
- frozen manifest or contract drift
- OpenAPI drift
- generated artifact mismatch

Expected output shape:
- the drift type in plain language
- the smallest visible entities that drifted
- when visible, the first anchor file or test surface to inspect
- the next action, usually regenerate or refresh only if the visible output already shows intentional drift-style evidence

Non-goals:
- environment/setup troubleshooting
- generic build or test triage
- broad repo analysis

## Current preset list

The built-in presets are:
- `test-status`
- `typecheck-summary`
- `lint-failures`
- `contract-drift`
- `audit-critical`
- `infra-risk`
- `diff-summary`
- `build-failure`
- `log-errors`

Run `sift presets list` for the live list in your current version.
