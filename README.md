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
sift exec --preset typecheck-summary -- npm run typecheck
sift exec --preset lint-failures -- eslint .
sift exec --preset audit-critical -- npm audit
sift exec --preset infra-risk -- terraform plan
```

## The main workflow

`sift exec` is the default path:

```bash
sift exec "what changed?" -- git diff
sift exec --preset test-status -- npm test
sift exec --preset test-status --show-raw -- npm test
sift exec --preset test-status --detail focused -- npm test
sift exec --preset test-status --detail verbose -- npm test
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
sift exec --preset test-status --detail focused -- npm test
sift exec --preset test-status --detail verbose -- npm test
sift exec --preset test-status --detail verbose --show-raw -- npm test
```

If you use a different runner, swap in your command:

```bash
sift exec --preset test-status -- pytest
sift exec --preset test-status --detail focused -- vitest
sift exec --preset test-status --detail verbose -- bun test
```

Typical shapes:

`standard`
```text
- Tests did not complete.
- 114 errors occurred during collection.
- Most failures are import/dependency errors during test collection.
- Missing modules include pydantic, fastapi, botocore, PIL, httpx, numpy.
```

`focused`
```text
- Tests did not complete.
- 114 errors occurred during collection.
- import/dependency errors during collection
  - tests/unit/test_auth_refresh.py -> missing module: botocore
  - tests/unit/test_cognito.py -> missing module: pydantic
  - and 103 more failing modules
```

`verbose`
```text
- Tests did not complete.
- 114 errors occurred during collection.
- tests/unit/test_auth_refresh.py -> missing module: botocore
- tests/unit/test_cognito.py -> missing module: pydantic
- tests/unit/test_dataset_use_case_facade.py -> missing module: fastapi
```

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

## Agent usage

The simple rule is:
- use `sift exec` for long, noisy, non-interactive command output
- skip `sift` when exact raw output matters

For Codex, put that rule in `~/.codex/AGENTS.md`.
For Claude Code, put the same rule in `CLAUDE.md`.

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
