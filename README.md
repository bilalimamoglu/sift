# sift

`sift` is a small wrapper for agent workflows.

Instead of giving a model the full output of `pytest`, `git diff`, `npm audit`, `tsc --noEmit`, `eslint .`, or `terraform plan`, you run the command through `sift`. `sift` captures the output, trims the noise, and returns a much smaller answer.

That answer can be short text or structured JSON.

## What it is

- a command-output reducer for agents
- best used with `sift exec ... -- <command>`
- designed for non-interactive shell commands
- supports native OpenAI and OpenAI-compatible APIs

## What it is not

- not a native Codex tool
- not an MCP server
- not a replacement for raw shell output when exact logs matter
- not meant for TUI or interactive password/confirmation flows

## Why use it

Large shell output is expensive and noisy.

If an agent only needs to know:
- did tests pass
- what changed
- are there critical vulnerabilities
- what are the blocking type errors
- what lint failures actually matter
- is this infra plan risky

then sending the full raw output to a large model is wasteful.

`sift` keeps the shell command, but shrinks what the model has to read.

## Installation

Requires Node.js 20 or later.

```bash
npm install -g @bilalimamoglu/sift
```

## One-time setup

Set credentials once in your shell:

```bash
export SIFT_PROVIDER=openai
export SIFT_BASE_URL=https://api.openai.com/v1
export SIFT_MODEL=gpt-5-nano
export OPENAI_API_KEY=your_openai_api_key
```

Or write them to a config file:

```bash
sift config init
```

For OpenAI-hosted models on `api.openai.com`, use `provider: openai` with `OPENAI_API_KEY`.

If you point `SIFT_BASE_URL` at a different compatible endpoint, switch to `provider: openai-compatible` and use that provider's native key when `sift` recognizes the endpoint, or set the generic fallback env:

```bash
export SIFT_PROVIDER_API_KEY=your_provider_api_key
```

`SIFT_PROVIDER_API_KEY` is the generic wrapper env for custom or self-hosted compatible endpoints. `openai-compatible` stays generic and does not imply OpenAI ownership.

Known native env fallbacks for recognized compatible endpoints:

- `OPENAI_API_KEY` for `https://api.openai.com/v1`
- `OPENROUTER_API_KEY` for `https://openrouter.ai/api/v1`
- `TOGETHER_API_KEY` for `https://api.together.xyz/v1`
- `GROQ_API_KEY` for `https://api.groq.com/openai/v1`

Use `provider: openai-compatible` for those compatible endpoints. Use `provider: openai` for OpenAI-hosted models.

## Quick start

```bash
sift exec "what changed?" -- git diff
sift exec --preset test-status -- pytest
sift exec --preset audit-critical -- npm audit
sift exec --preset typecheck-summary -- tsc --noEmit
sift exec --preset lint-failures -- eslint .
sift exec --preset infra-risk -- terraform plan
```

## Main workflow

`sift exec` is the main path:

```bash
sift exec "did tests pass?" -- pytest
sift exec "what changed?" -- git diff
sift exec --preset infra-risk -- terraform plan
sift exec --dry-run "what changed?" -- git diff
```

What happens:

1. `sift` runs the command.
2. It captures `stdout` and `stderr`.
3. It sanitizes, optionally redacts, and truncates the result.
4. It sends the reduced input to a smaller model.
5. It prints a short answer or JSON.
6. It preserves the wrapped command's exit code.

Use `--dry-run` to inspect the reduced input and prompt without calling the provider.

## Pipe mode

If the output already exists in a pipeline, pipe mode still works:

```bash
git diff 2>&1 | sift "what changed?"
```

Use pipe mode when the command is already being produced elsewhere.

## Presets

Built-in presets:

- `test-status`
- `audit-critical`
- `diff-summary`
- `build-failure`
- `log-errors`
- `typecheck-summary`: groups blocking type errors by root cause and points to the first files or symbols to fix.
- `lint-failures`: groups repeated lint violations and highlights the files and rules that matter.
- `infra-risk`

Inspect them with:

```bash
sift presets list
sift presets show audit-critical
```

## Output modes

- `brief`: short plain-text answer
- `bullets`: short bullet list
- `json`: structured JSON
- `verdict`: `{ verdict, reason, evidence }`

Some built-in presets also use local heuristics before calling a model. For example, `infra-risk` can mark obvious destructive plans as `fail` without sending the whole decision to the model.

## JSON response format

When `format` resolves to JSON, `sift` can ask the provider for native JSON output.

- `auto`: enable native JSON mode only for known-safe endpoints such as `https://api.openai.com/v1`
- `on`: always send the native JSON response format request
- `off`: never send it

Example:

```bash
sift exec --format json --json-response-format on "summarize this" -- some-command
```

## Config

Generate an example config:

```bash
sift config init
```

`sift config show` masks secret values by default. Use `sift config show --show-secrets` only when you explicitly need the raw values.

Resolution order:

1. CLI flags
2. environment variables
3. `sift.config.yaml` or `sift.config.yml`
4. `~/.config/sift/config.yaml` or `~/.config/sift/config.yml`
5. built-in defaults

If you pass `--config <path>`, that path is treated strictly. Missing explicit config paths are errors; `sift` does not silently fall back to defaults in that case.

Supported environment variables:

- `SIFT_PROVIDER`
- `SIFT_MODEL`
- `SIFT_BASE_URL`
- `SIFT_PROVIDER_API_KEY`
- `OPENAI_API_KEY` for `provider: openai` and for `https://api.openai.com/v1` in `openai-compatible` mode
- `OPENROUTER_API_KEY` for `https://openrouter.ai/api/v1`
- `TOGETHER_API_KEY` for `https://api.together.xyz/v1`
- `GROQ_API_KEY` for `https://api.groq.com/openai/v1`
- `SIFT_MAX_CAPTURE_CHARS`
- `SIFT_TIMEOUT_MS`
- `SIFT_MAX_INPUT_CHARS`

Example config:

```yaml
provider:
  provider: openai
  model: gpt-5-nano
  baseUrl: https://api.openai.com/v1
  apiKey: YOUR_API_KEY
  timeoutMs: 20000
  temperature: 0.1
  maxOutputTokens: 400

input:
  stripAnsi: true
  redact: true
  redactStrict: false
  maxCaptureChars: 400000
  maxInputChars: 60000
  headChars: 20000
  tailChars: 20000

runtime:
  rawFallback: true
  verbose: false
```

## Commands

```bash
sift [question]
sift preset <name>
sift exec [question] -- <program> [args...]
sift exec --preset <name> -- <program> [args...]
sift exec [question] --shell "<command string>"
sift exec --preset <name> --shell "<command string>"
sift config init
sift config show
sift config validate
sift doctor
sift presets list
sift presets show <name>
```

## Releasing

`sift` uses a manual GitHub Actions release workflow with npm trusted publishing.

Before the first release:

1. configure npm trusted publishing for `@bilalimamoglu/sift`
2. point it at `bilalimamoglu/sift`
3. use the workflow filename `release.yml`
4. set the GitHub Actions environment name to `release`

For each release:

1. update `package.json` to the target version
2. merge the final release commit to `main`
3. open GitHub Actions and run the `release` workflow manually

The workflow will:

1. install dependencies
2. typecheck, test, and build
3. pack and smoke-test the tarball
4. publish to npm
5. create and push the `vX.Y.Z` tag
6. create a GitHub Release

`release.yml` uses OIDC trusted publishing, so it does not require an `NPM_TOKEN`.

## Using it with Claude Code

Add a short rule to your project's `CLAUDE.md`:

```md
## Command output

When running shell commands whose output will be read or summarized, prefer
`sift exec` over running the command directly. This reduces the context window
cost of large outputs.

Examples:
- Tests: `sift exec --preset test-status -- npm test`
- Typecheck: `sift exec --preset typecheck-summary -- tsc --noEmit`
- Lint: `sift exec --preset lint-failures -- eslint .`
- Audit: `sift exec --preset audit-critical -- npm audit`
- Diff: `sift exec "what changed?" -- git diff`
- Infra: `sift exec --preset infra-risk -- terraform plan`

Do not use `sift` when exact raw output is required (e.g. reading file contents,
debugging a specific line number, or copying verbatim output).
```

Claude Code reads `CLAUDE.md` at the start of every conversation, so it will
use `sift exec` for noisy commands and skip it when exact output matters.

Credentials are inherited from the shell environment or `sift.config.yaml`.
Do not put API keys in `CLAUDE.md`.

## Using it with Codex

The same pattern works for Codex. Add the rule to `~/.codex/AGENTS.md` instead.

Codex inherits credentials from the shell environment or `sift.config.yaml`.
It should not pass API keys inline on every command.

## Safety and limits

- Redaction is optional and regex-based.
- Redaction is off by default. If command output may contain secrets, enable `--redact` or set it in config before sending output to a provider.
- Built-in JSON and verdict flows return strict error objects on provider/model failure.
- Retriable provider failures such as `429`, timeouts, and `5xx` responses are retried once before falling back.
- `sift exec` detects simple prompt-like output such as `[y/N]` or `password:` and skips reduction instead of guessing.
- Pipe mode does not preserve upstream shell pipeline failures; use `set -o pipefail` if you need that behavior.
- `sift exec` mirrors the wrapped command's exit code.
- `sift doctor` is a conservative local config check. For the default OpenAI-compatible path it requires `baseUrl`, `model`, and `apiKey`.

## Current scope

`sift` is intentionally small.

Today it supports:
- native OpenAI (Responses API) and OpenAI-compatible providers
- agent-first `exec` mode
- pipe mode
- presets
- local redaction and truncation
- strict JSON/verdict fallbacks

It does not try to be a full agent platform.

## License

MIT

The top-level MIT license is the licensing surface for this repo. Per-file license headers are not required unless code is copied or adapted from another source that needs separate notice or attribution.
