# CLI Reference

This page covers the useful `sift` commands that do not need to dominate the main README.

The main README is product-first. This page is command-first.

## Core commands

### `sift exec`

Run a command, capture its output, reduce it, and preserve the child exit code.

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
- For cached `vitest` and `jest` runs, `sift rerun --remaining` reruns the original full command and keeps the diagnosis focused on what still fails relative to the cached baseline.
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

Use this when the cached diagnosis is close but you want one deeper render before going to raw logs.

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

Interactive guided setup for provider configuration.

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

Check which config is active and whether the local setup is complete.

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

### `sift agent install`

Install a managed instruction block for a supported agent.

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
