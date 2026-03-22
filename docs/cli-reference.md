# CLI Reference

This page covers the useful `sift` commands that do not need to dominate the main README.

The main README is product-first. This page is command-first.

## Core commands

### `sift exec`

Run a command, capture its output, and turn noisy results into a smaller, more actionable first pass while preserving the child exit code.

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

```bash
sift doctor
```

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

If you pick `provider-assisted`, the installer continues directly into provider/model/API-key setup instead of telling you to run `sift config setup` separately.

```bash
sift install
sift install codex --scope global --yes
sift install all --scope local --yes
```

### `sift agent install`

Install a managed instruction block for a supported agent directly. Use this when you want dry runs, raw block output, or a low-level override.

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

## Current preset list

The built-in presets are:
- `test-status`
- `typecheck-summary`
- `lint-failures`
- `audit-critical`
- `infra-risk`
- `diff-summary`
- `build-failure`
- `log-errors`

Run `sift presets list` for the live list in your current version.
