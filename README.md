# sift

<img src="assets/brand/sift-logo-minimal-monochrome.svg" alt="sift logo" width="120" />

Most command output is long and noisy, but the thing you actually need to know is short: what failed, where, and what to do next. `sift` runs the command for you, captures the output, and gives you a short answer instead of a wall of text.

It works with test suites, build logs, `git diff`, `npm audit`, `terraform plan` — anything where the signal is buried in noise. It always tries the cheapest approach first and only escalates when needed. Exit codes are preserved.

Skip it when:
- you need the exact raw log
- the command is interactive or TUI-based
- the output is already short

## Install

Requires Node.js 24 or later.

```bash
npm install -g @bilalimamoglu/sift
```

## Setup

The interactive setup writes a machine-wide config and walks you through provider selection:

```bash
sift config setup
sift doctor          # verify it works
```

Config is saved to `~/.config/sift/config.yaml`. A repo-local `sift.config.yaml` can override it later.

If you prefer environment variables instead:

```bash
# OpenAI
export SIFT_PROVIDER=openai
export SIFT_BASE_URL=https://api.openai.com/v1
export SIFT_MODEL=gpt-5-nano
export OPENAI_API_KEY=your_openai_api_key

# or OpenRouter
export SIFT_PROVIDER=openrouter
export OPENROUTER_API_KEY=your_openrouter_api_key

# or any OpenAI-compatible endpoint (Together, Groq, self-hosted, etc.)
export SIFT_PROVIDER=openai-compatible
export SIFT_BASE_URL=https://your-endpoint/v1
export SIFT_PROVIDER_API_KEY=your_api_key
```

To switch between saved providers without editing files:

```bash
sift config use openai
sift config use openrouter
```

## Usage

Run a noisy command through `sift`, read the short answer, and only zoom in if it tells you to:

```bash
sift exec --preset test-status -- pytest -q
sift exec "what changed?" -- git diff
sift exec --preset audit-critical -- npm audit
sift exec --preset infra-risk -- terraform plan
```

`sift exec` runs the child command, captures its output, reduces it, and preserves the original exit code.

Useful flags:
- `--dry-run`: show the reduced input and prompt without calling the provider
- `--show-raw`: print the captured raw output to `stderr`

## Test debugging workflow

This is the most common use case and where `sift` adds the most value.

Think of it like this:
- `standard` = map
- `focused` or `rerun --remaining` = zoom
- raw traceback = last resort

For most repos, the whole story is:

```bash
sift exec --preset test-status -- <test command>   # get the map
sift rerun                                          # after a fix, refresh the truth
sift rerun --remaining --detail focused             # zoom into what's still failing
```

`test-status` becomes test-aware because you chose the preset. It does **not** infer "this is a test command" from the runner name — use the same preset with `pytest`, `vitest`, `jest`, `bun test`, or any other runner.

If `standard` already names the failure buckets, counts, and hints, stop there and read code. If it ends with `Decision: zoom`, do one deeper pass before falling back to raw traceback.

### What `sift` returns for each failure family

- `Shared blocker` — one setup problem affecting many tests
- A named family such as import, timeout, network, migration, or assertion
- `Anchor` — the first file, line window, or search term worth opening
- `Fix` — the likely next move
- `Decision` — whether to stop here or zoom one step deeper
- `Next` — the smallest practical action

### Detail levels

- `standard` — short summary, no file list (default)
- `focused` — groups failures by error type, shows a few representative tests
- `verbose` — flat list of all visible failing tests with their normalized reason

### Example output

Single failure family:
```text
- Tests did not complete.
- 114 errors occurred during collection.
- Import/dependency blocker: repeated collection failures are caused by missing dependencies.
- Anchor: path/to/failing_test.py
- Fix: Install the missing dependencies and rerun the affected tests.
- Decision: stop and act. Do not escalate unless you need exact traceback lines.
- Next: Fix bucket 1 first, then rerun the full suite at standard.
```

Multiple failure families in one pass:
```text
- Tests did not pass.
- 3 tests failed. 124 errors occurred.
- Shared blocker: DB-isolated tests are missing a required test env var.
  Anchor: search <TEST_ENV_VAR> in path/to/test_setup.py
  Fix: Set the required test env var and rerun the suite.
- Contract drift: snapshot expectations are out of sync with the current API or model state.
  Anchor: search <route-or-entity> in path/to/freeze_test.py
  Fix: Review the drift and regenerate the snapshots if the change is intentional.
- Decision: stop and act.
- Next: Fix bucket 1 first, then rerun the full suite at standard.
```

### Recommended debugging order

1. `sift exec --preset test-status -- <test command>` — get the map.
2. If `standard` already shows root cause, `Anchor`, and `Fix`, trust it and act.
3. `sift escalate` — deeper render of the same cached output, without rerunning.
4. `sift rerun` — after a fix, refresh the full-suite truth at `standard`.
5. `sift rerun --remaining --detail focused` — zoom into what is still failing.
6. `sift rerun --remaining --detail verbose`
7. `sift rerun --remaining --detail verbose --show-raw`
8. Raw test command only if exact traceback lines are still needed.

`sift rerun --remaining` currently supports only cached `pytest` or `python -m pytest` runs. For other runners, rerun a narrowed command manually with `sift exec --preset test-status -- <narrowed command>`.

### Quick glossary

- `sift escalate` = same cached output, deeper render
- `sift rerun` = rerun the cached command at `standard`, show what resolved or remained
- `sift rerun --remaining` = rerun only the remaining failing test nodes
- `Decision: stop and act` = trust the diagnosis and go fix code
- `Decision: zoom` = one deeper sift pass is justified before raw

## Watch mode

Use watch mode when output redraws or repeats across cycles:

```bash
sift watch "what changed between cycles?" < watcher-output.txt
sift exec --watch "what changed between cycles?" -- node watcher.js
sift exec --watch --preset test-status -- pytest -f
```

- cycle 1 = current state
- later cycles = what changed, what resolved, what stayed, and the next best action
- for `test-status`, resolved tests drop out and remaining failures stay in focus

## Diagnose JSON

Start with text. Use JSON only when automation needs machine-readable output:

```bash
sift exec --preset test-status --goal diagnose --format json -- pytest -q
sift rerun --goal diagnose --format json
```

The JSON is summary-first: `remaining_summary`, `resolved_summary`, `read_targets` with optional `context_hint`, and `remaining_subset_available` to tell you whether `sift rerun --remaining` can zoom safely.

Add `--include-test-ids` only when you need every raw failing test ID.

## Built-in presets

- `test-status`: summarize test runs
- `typecheck-summary`: group blocking type errors by root cause
- `lint-failures`: group repeated lint violations and highlight the files or rules that matter
- `audit-critical`: extract only high and critical vulnerabilities
- `infra-risk`: return a safety verdict for infra changes
- `diff-summary`: summarize code changes and risks
- `build-failure`: explain the most likely build failure
- `log-errors`: extract the most relevant error signals

```bash
sift presets list
sift presets show test-status
```

## Agent setup

`sift` can install a managed instruction block so Codex or Claude Code uses `sift` by default for long command output:

```bash
sift agent install codex
sift agent install claude
```

This writes a managed block to `AGENTS.md` or `CLAUDE.md` in the current repo. Use `--dry-run` to preview, or `--scope global` for machine-wide instructions.

```bash
sift agent status
sift agent remove codex
sift agent remove claude
```

## CI usage

Some commands succeed technically but should still block CI. `--fail-on` handles that:

```bash
sift exec --preset audit-critical --fail-on -- npm audit
sift exec --preset infra-risk --fail-on -- terraform plan
```

## Config

```bash
sift config show          # masks secrets by default
sift config show --show-secrets
sift config validate
```

Config precedence:
1. CLI flags
2. environment variables
3. repo-local `sift.config.yaml`
4. machine-wide `~/.config/sift/config.yaml`
5. built-in defaults

If you pass `--config <path>`, that path is strict — missing paths are errors.

Minimal YAML config:

```yaml
provider:
  provider: openai
  model: gpt-5-nano
  baseUrl: https://api.openai.com/v1
  apiKey: YOUR_API_KEY

input:
  stripAnsi: true
  redact: false
  maxCaptureChars: 400000
  maxInputChars: 60000

runtime:
  rawFallback: true
```

## Safety and limits

- redaction is optional and regex-based
- retriable provider failures (`429`, timeouts, `5xx`) are retried once
- `sift exec` detects interactive prompts (`[y/N]`, `password:`) and skips reduction
- pipe mode does not preserve upstream pipeline failures; use `set -o pipefail` if needed

## Releasing

This repo uses a manual GitHub Actions release workflow with npm trusted publishing.

1. bump `package.json`
2. merge to `main`
3. run the `release` workflow manually

The workflow runs typecheck, tests, coverage, build, packaging smoke checks, npm publish, tag creation, and GitHub Release creation.

Release notes: if `release-notes/v<version>.md` or `release-notes/<version>.md` exists, the workflow uses it. Otherwise it falls back to GitHub generated notes.

## Maintainer benchmark

```bash
npm run bench:test-status-ab
npm run bench:test-status-live
```

Uses the `o200k_base` tokenizer and reports command-output budget as the primary benchmark, with deterministic recipe-budget comparisons and live-session scorecards as supporting evidence.

## Brand assets

Logo assets live in `assets/brand/`: badge/app, icon-only, and 24px icon variants in teal, black, and monochrome.

## License

MIT
