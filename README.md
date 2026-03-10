# sift

<img src="assets/brand/sift-logo-badge-monochrome.svg" alt="sift logo" width="88" />

`sift` is a small command-output reducer for agent workflows.

Instead of feeding a model the full output of `pytest`, `git diff`, `npm audit`, `tsc --noEmit`, `eslint .`, or `terraform plan`, you run the command through `sift`. It captures the output, trims the noise, and returns a much smaller answer.

Best fit:
- non-interactive shell commands
- agents that need short answers instead of full logs
- CI checks where a command may succeed but still produce a blocking result

Not a fit:
- exact raw log inspection
- TUI tools
- password/confirmation prompts

## Installation

Requires Node.js 20 or later.

```bash
npm install -g @bilalimamoglu/sift
```

## One-time setup

For OpenAI-hosted models:

```bash
export SIFT_PROVIDER=openai
export SIFT_BASE_URL=https://api.openai.com/v1
export SIFT_MODEL=gpt-5-nano
export OPENAI_API_KEY=your_openai_api_key
```

Or generate a config file:

```bash
sift config init
```

If you use a different OpenAI-compatible endpoint, switch to `provider: openai-compatible` and use either the endpoint's native API key env var or the generic fallback:

```bash
export SIFT_PROVIDER_API_KEY=your_provider_api_key
```

Common compatible env fallbacks:
- `OPENROUTER_API_KEY`
- `TOGETHER_API_KEY`
- `GROQ_API_KEY`

## Quick start

```bash
sift exec "what changed?" -- git diff
sift exec --preset test-status -- pytest
sift exec --preset typecheck-summary -- tsc --noEmit
sift exec --preset lint-failures -- eslint .
sift exec --preset audit-critical -- npm audit
sift exec --preset infra-risk -- terraform plan
sift exec --preset audit-critical --fail-on -- npm audit
sift exec --preset infra-risk --fail-on -- terraform plan
```

## Main workflow

`sift exec` is the default path:

```bash
sift exec "did tests pass?" -- pytest
sift exec --dry-run "what changed?" -- git diff
```

What it does:
1. runs the command
2. captures `stdout` and `stderr`
3. sanitizes, optionally redacts, and truncates the output
4. sends the reduced input to a smaller model
5. prints a short answer or JSON
6. preserves the wrapped command's exit code

Use `--dry-run` to inspect the reduced input and prompt without calling the provider.

Use `--fail-on` when a built-in semantic preset should turn a technically successful command into a CI failure. Supported presets:
- `infra-risk`
- `audit-critical`

Pipe mode still works when output already exists:

```bash
git diff 2>&1 | sift "what changed?"
```

## Built-in presets

- `test-status`: summarize test results
- `typecheck-summary`: group blocking type errors by root cause
- `lint-failures`: group repeated lint violations and highlight the files or rules that matter
- `audit-critical`: extract only high and critical vulnerabilities
- `infra-risk`: return a safety verdict for infra changes
- `diff-summary`: summarize code changes and risks
- `build-failure`: explain the most likely build failure
- `log-errors`: extract the most relevant error signals

Inspect them with:

```bash
sift presets list
sift presets show audit-critical
```

## Output modes

- `brief`
- `bullets`
- `json`
- `verdict`

Built-in JSON and verdict flows return strict error objects on provider or model failure.

## Config

Useful commands:

```bash
sift config init
sift config show
sift config validate
sift doctor
```

`sift config show` masks secrets by default. Use `--show-secrets` only when you explicitly need raw values.

Resolution order:
1. CLI flags
2. environment variables
3. `sift.config.yaml` or `sift.config.yml`
4. `~/.config/sift/config.yaml` or `~/.config/sift/config.yml`
5. built-in defaults

If you pass `--config <path>`, that path is strict. Missing explicit config paths are errors.

Minimal example:

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

## Agent usage

For Claude Code, add a short rule to `CLAUDE.md`.

For Codex, add the same rule to `~/.codex/AGENTS.md`.

The important part is simple:
- prefer `sift exec` for noisy shell commands
- skip `sift` when exact raw output matters
- keep credentials in your shell env or `sift.config.yaml`, never inline in prompts or agent instructions

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

The workflow:
1. installs dependencies
2. runs typecheck, tests, and build
3. packs and smoke-tests the tarball
4. publishes to npm
5. creates and pushes the `vX.Y.Z` tag
6. creates a GitHub Release

## Brand assets

Curated public logo assets live in `assets/brand/`.

Included SVG sets:
- badge/app: teal, black, monochrome
- icon-only: teal, black, monochrome
- 24px icon: teal, black, monochrome

## License

MIT
