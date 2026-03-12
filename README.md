# sift

<img src="assets/brand/sift-logo-badge-monochrome.svg" alt="sift logo" width="88" />

`sift` is a small CLI that runs a noisy shell command, keeps the useful signal, and returns a much smaller answer.

It is a good fit when you want an agent or CI job to understand:
- test results
- typecheck failures
- lint failures
- build logs
- `git diff`
- `npm audit`
- `terraform plan`

It is not a good fit when you need:
- the exact raw log as the main output
- interactive or TUI commands
- shell behavior that depends on raw command output

## Install

Requires Node.js 20 or later.

```bash
npm install -g @bilalimamoglu/sift
```

## One-time setup

The easiest setup path is:

```bash
sift config setup
```

That writes a machine-wide config to:

```text
~/.config/sift/config.yaml
```

After that, any terminal on the machine can use `sift`. A repo-local config can still override it later.

If you prefer manual setup, this is the smallest useful OpenAI setup:

```bash
export SIFT_PROVIDER=openai
export SIFT_BASE_URL=https://api.openai.com/v1
export SIFT_MODEL=gpt-5-nano
export OPENAI_API_KEY=your_openai_api_key
```

Then check it:

```bash
sift doctor
```

## Quick start

```bash
sift exec "what changed?" -- git diff
sift exec --preset test-status -- npm test
sift rerun
sift rerun --remaining --detail focused
sift rerun --remaining --detail verbose --show-raw
sift exec --preset test-status --goal diagnose --format json -- pytest -q
sift watch "what changed between cycles?" < watcher-output.txt
sift exec --watch "what changed between cycles?" -- node watcher.js
sift exec --preset typecheck-summary -- npm run typecheck
sift exec --preset lint-failures -- eslint .
sift exec --preset audit-critical -- npm audit
sift exec --preset infra-risk -- terraform plan
sift agent install codex --dry-run
```

## The main workflow

`sift exec` is the default path:

```bash
sift exec "what changed?" -- git diff
sift exec --preset test-status -- npm test
sift rerun
sift rerun --remaining --detail focused
sift rerun --remaining --detail verbose --show-raw
sift watch "what changed between cycles?" < watcher-output.txt
```

If your project uses `pytest`, `vitest`, `jest`, `bun test`, or another test runner instead of `npm test`, use the same preset with that command.

What happens:
1. `sift` runs the command
2. captures `stdout` and `stderr`
3. trims the noise
4. sends a smaller input to the model
5. prints a short answer or JSON
6. preserves the child command exit code in `exec` mode

Useful debug flags:
- `--dry-run`: show the reduced input and prompt without calling the provider
- `--show-raw`: print the captured raw input to `stderr`

For `test-status`, `sift` also caches the last non-interactive exec run so you can choose between the same cached output, a fresh full-suite rerun, and a narrowed pytest-only zoom:

```bash
sift exec --preset test-status -- npm test
sift escalate
sift rerun
sift rerun --remaining --detail focused
sift rerun --remaining --detail verbose --show-raw
```

Mental model:
- `sift escalate` = same cached output, deeper render
- `sift rerun` = rerun the cached full command at `standard` and prepend what resolved, remained, or changed
- `sift rerun --remaining` = rerun only the remaining failing pytest node IDs for a zoomed-in view
- `sift watch` / `sift exec --watch` = treat redraw-style output as cycles and summarize what changed

If you need a machine-readable diagnosis for tests, use:

```bash
sift exec --preset test-status --goal diagnose --format json -- pytest -q
sift rerun --goal diagnose --format json
sift watch --preset test-status --goal diagnose --format json < pytest-watch.txt
```

`--goal diagnose --format json` is currently supported only for `test-status`, `rerun`, and `test-status` watch flows.

If you want the older explicit compare shape, `sift exec --preset test-status --diff -- <test command>` still works. `sift rerun` is the shorter normal path for the same idea.

## Watch mode

Use watch mode when command output redraws or repeats and you care about cycle-to-cycle change summaries more than the raw stream:

```bash
sift watch "what changed between cycles?" < watcher-output.txt
sift exec --watch "what changed between cycles?" -- node watcher.js
sift exec --watch --preset test-status -- pytest -f
```

`sift watch` keeps the current summary and change summary together:
- cycle 1 = current state
- later cycles = what changed, what resolved, what stayed, and the next best action
- for `test-status`, resolved tests drop out and remaining failures stay in focus

If the stream clearly looks like a redraw/watch session, `sift` can auto-switch to watch handling and prints a short stderr note when it does.

## `test-status` detail modes

If you are running `npm test` and want `sift` to check the result, use `--preset test-status`.

`test-status` becomes test-aware because you chose the preset. It does **not** infer “this is a test command” from `pytest`, `vitest`, `npm test`, or any other runner name.

Available detail levels:

- `standard`
  - short default summary
  - no file list
- `focused`
  - groups failures by error type
  - shows a few representative failing tests or modules
- `verbose`
  - flat list of visible failing tests or modules and their normalized reason
  - useful when Codex needs to know exactly what to fix first

Examples:

```bash
sift exec --preset test-status -- npm test
sift rerun
sift rerun --remaining --detail focused
sift rerun --remaining --detail verbose
sift rerun --remaining --detail verbose --show-raw
```

If you use a different runner, swap in your command:

```bash
sift exec --preset test-status -- pytest
sift rerun
sift rerun --remaining --detail focused
sift rerun --remaining --detail verbose --show-raw
```

`sift rerun --remaining` currently supports only cached argv-mode `pytest ...` or `python -m pytest ...` runs. If the cached command is not subset-capable, run a narrowed pytest command manually with `sift exec --preset test-status -- <narrowed pytest command>`.

Typical shapes:

`standard`
```text
- Tests did not complete.
- 114 errors occurred during collection.
- Import/dependency blocker: 114 errors are caused by missing dependencies during test collection.
- Missing modules include pydantic, fastapi, botocore, PIL, httpx, numpy.
- Hint: Install the missing dependencies and rerun the affected tests.
- Next: Fix bucket 1 first, then rerun the full suite at standard.
- Stop signal: diagnosis complete; raw not needed.
```

`standard` can also separate more than one failure family in a single pass:
```text
- Tests did not pass.
- 3 tests failed. 124 errors occurred.
- Shared blocker: 124 errors require PGTEST_POSTGRES_DSN for DB-isolated tests.
- Contract drift: 3 freeze tests are out of sync with current API/model state.
- OpenAPI drift includes 4 added landing-gallery paths.
- Hint: set PGTEST_POSTGRES_DSN (or pass --pgtest-dsn) before rerunning DB-backed tests.
- Hint: review and regenerate the contract snapshots if these API/model changes are intentional.
- Next: Fix bucket 1 first, then rerun the full suite at standard. Secondary buckets are already visible behind it.
- Stop signal: diagnosis complete; raw not needed.
```

`focused`
```text
- Tests did not complete.
- 114 errors occurred during collection.
- Import/dependency blocker: missing dependencies are blocking collection.
  - Missing modules include botocore, pydantic.
  - tests/unit/test_auth_refresh.py -> missing module: botocore
  - tests/unit/test_cognito.py -> missing module: pydantic
  - Hint: Install the missing dependencies and rerun the affected tests.
 - Next: Fix bucket 1 first, then rerun the full suite at standard.
 - Stop signal: diagnosis complete; raw not needed.
```

`verbose`
```text
- Tests did not complete.
- 114 errors occurred during collection.
- Import/dependency blocker: missing dependencies are blocking collection.
  - tests/unit/test_auth_refresh.py -> missing module: botocore
  - tests/unit/test_cognito.py -> missing module: pydantic
  - tests/unit/test_dataset_use_case_facade.py -> missing module: fastapi
  - Hint: Install the missing dependencies and rerun the affected tests.
 - Next: Fix bucket 1 first, then rerun the full suite at standard.
 - Stop signal: diagnosis complete; raw not needed.
```

Recommended debugging order for tests:
1. Use `standard` for the full suite first.
2. Treat `standard` as the map. If it already shows the main buckets, counts, and hints, stop there and read source.
3. Use `sift escalate` only when you want a deeper render of the same cached output without rerunning the command.
4. After fixing something, run `sift rerun` to refresh the full-suite truth at `standard`.
5. Only then use `sift rerun --remaining --detail focused` as the zoom lens after the full-suite truth is refreshed.
6. Then use `sift rerun --remaining --detail verbose`.
7. Then use `sift rerun --remaining --detail verbose --show-raw`.
8. Fall back to the raw pytest command only if you still need exact traceback lines for the remaining failing subset.

## Built-in presets

- `test-status`: summarize test runs
- `typecheck-summary`: group blocking type errors by root cause
- `lint-failures`: group repeated lint violations and highlight the files or rules that matter
- `audit-critical`: extract only high and critical vulnerabilities
- `infra-risk`: return a safety verdict for infra changes
- `diff-summary`: summarize code changes and risks
- `build-failure`: explain the most likely build failure
- `log-errors`: extract the most relevant error signals

List or inspect them:

```bash
sift presets list
sift presets show test-status
```

## Agent setup

If you want Codex or Claude Code to use `sift` by default, let `sift` install a managed instruction block for you.

Repo scope is the default because it is safer:

```bash
sift agent show codex
sift agent show codex --raw
sift agent install codex --dry-run
sift agent install codex --dry-run --raw
sift agent install codex
sift agent install claude
```

You can also install machine-wide instructions explicitly:

```bash
sift agent install codex --scope global
sift agent install claude --scope global
```

Useful commands:

```bash
sift agent status
sift agent remove codex
sift agent remove claude
```

`sift agent show ...` is a preview. It also tells you whether the managed block is already installed in the current scope.

What the installer does:
- writes to `AGENTS.md` or `CLAUDE.md` by default in the current repo
- uses marked managed blocks instead of rewriting the whole file
- preserves your surrounding notes and instructions
- can use global files when you explicitly choose `--scope global`
- keeps previews short by default
- shows the exact managed block or final dry-run content only with `--raw`

What the managed block tells the agent:
- start with `sift` for long non-interactive command output so the agent spends less context-window and token budget on raw logs
- for tests, begin with the normal `test-status` summary
- if `standard` already identifies the main buckets, stop there instead of escalating automatically
- use `sift escalate` only for the same cached output when more detail is needed without rerunning the command
- after a fix, refresh the truth with `sift rerun`
- only then zoom into the remaining failing pytest subset with `sift rerun --remaining --detail focused`, then `verbose`, then `--show-raw`
- fall back to the raw test command only when exact traceback lines are still needed

## CI-friendly usage

Some commands succeed technically but should still block CI. `--fail-on` handles that for the built-in semantic presets that have stable machine-readable output:

```bash
sift exec --preset audit-critical --fail-on -- npm audit
sift exec --preset infra-risk --fail-on -- terraform plan
```

Supported presets for `--fail-on`:
- `audit-critical`
- `infra-risk`

## Config

Useful commands:

```bash
sift config setup
sift config init
sift config show
sift config validate
sift doctor
```

`sift config show` masks secrets by default. Use `--show-secrets` only when you explicitly need raw values.

Config precedence:
1. CLI flags
2. environment variables
3. repo-local `sift.config.yaml` or `sift.config.yml`
4. machine-wide `~/.config/sift/config.yaml` or `~/.config/sift/config.yml`
5. built-in defaults

## Maintainer benchmark

To compare raw pytest output against the `test-status` reduction ladder on fixed fixtures, run:

```bash
npm run bench:test-status-ab
```

This uses the real `o200k_base` tokenizer and reports both:
- command-output budget as the primary benchmark
- deterministic recipe-budget comparisons as supporting evidence only

The benchmark is meant to show context-window and command-output reduction first. In normal debugging flows, `test-status` should usually stop at `standard`; `focused` and `verbose` are escalation tools, and raw pytest is the last resort when exact traceback evidence is still needed.

If you pass `--config <path>`, that path is strict. Missing explicit config paths are errors.

Minimal config example:

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

## OpenAI vs OpenAI-compatible

Use `provider: openai` for `api.openai.com`.

Use `provider: openai-compatible` for third-party compatible gateways or self-hosted endpoints.

For OpenAI:
```bash
export OPENAI_API_KEY=your_openai_api_key
```

For third-party compatible endpoints, use either the endpoint-native env var or:

```bash
export SIFT_PROVIDER_API_KEY=your_provider_api_key
```

Known compatible env fallbacks include:
- `OPENROUTER_API_KEY`
- `TOGETHER_API_KEY`
- `GROQ_API_KEY`

## Safety and limits

- redaction is optional and regex-based
- retriable provider failures such as `429`, timeouts, and `5xx` are retried once
- `sift exec` detects simple prompt-like output such as `[y/N]` or `password:` and skips reduction
- pipe mode does not preserve upstream shell pipeline failures; use `set -o pipefail` if you need that behavior

## Releasing

This repo uses a manual GitHub Actions release workflow with npm trusted publishing.

Release flow:
1. bump `package.json`
2. merge to `main`
3. run the `release` workflow manually

The workflow runs typecheck, tests, coverage, build, packaging smoke checks, npm publish, tag creation, and GitHub Release creation.

## Brand assets

Curated public logo assets live in `assets/brand/`.

Included SVG sets:
- badge/app: teal, black, monochrome
- icon-only: teal, black, monochrome
- 24px icon: teal, black, monochrome

## License

MIT
