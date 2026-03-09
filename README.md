# sift

Agent-first command-output reduction for agents, CI, and automation.

## Why

CLI output is often too noisy, too long, and too expensive to pass directly into a larger model.

Sift can run a command for you, capture its output, reduce it locally, and send only the useful signal to an OpenAI-compatible backend.

The result is a short answer or a small JSON payload that automation can use directly.

## Features

- agent-first `sift exec` workflow
- OpenAI-compatible provider interface
- brief, bullets, json, and verdict output modes
- preset system for common tasks
- YAML config with env and CLI overrides
- local sanitize, redact, and truncate pipeline
- bounded raw capture before reduction
- strict error objects for JSON/verdict provider failures
- quality gate for meta or malformed model output
- prompt bypass for simple interactive prompts
- doctor command for runtime inspection

## Installation

```bash
npm install -g @bilalimamoglu/sift
```

## Quick start

```bash
sift exec "what changed?" --api-key "$OPENAI_API_KEY" -- git diff
sift exec preset test-status --api-key "$OPENAI_API_KEY" -- pytest
sift exec preset audit-critical --api-key "$OPENAI_API_KEY" -- npm audit
sift exec preset infra-risk --api-key "$OPENAI_API_KEY" -- terraform plan
```

## Existing pipelines

If you already have command output in a pipeline, pipe mode still works:

```bash
git diff 2>&1 | sift "what changed?" --api-key "$OPENAI_API_KEY"
```

## Config

Generate an example config:

```bash
sift config init
```

Sift resolves configuration in this order:

1. CLI flags
2. environment variables
3. `sift.config.yaml` or `sift.config.yml`
4. `~/.config/sift/config.yaml` or `~/.config/sift/config.yml`
5. built-in defaults

Supported environment variables:

- `SIFT_PROVIDER`
- `SIFT_MODEL`
- `SIFT_BASE_URL`
- `SIFT_API_KEY`
- `SIFT_MAX_CAPTURE_CHARS`
- `SIFT_TIMEOUT_MS`
- `SIFT_MAX_INPUT_CHARS`

## Commands

```bash
sift [question]
sift preset <name>
sift exec [question] -- <program> [args...]
sift exec [question] --shell "<command string>"
sift config init
sift config show
sift config validate
sift doctor
sift presets list
sift presets show <name>
```

## Example config

```yaml
provider:
  provider: openai-compatible
  model: gpt-4.1-mini
  baseUrl: https://api.openai.com/v1
  apiKey: YOUR_API_KEY
  timeoutMs: 20000
  temperature: 0.1
  maxOutputTokens: 220

input:
  stripAnsi: true
  redact: true
  redactStrict: false
  maxCaptureChars: 250000
  maxInputChars: 20000
  headChars: 6000
  tailChars: 6000

runtime:
  rawFallback: true
  verbose: false
```

## Presets

Built-in presets:

- `test-status`
- `audit-critical`
- `diff-summary`
- `build-failure`
- `log-errors`
- `infra-risk`

Inspect them with:

```bash
sift presets list
sift presets show audit-critical
```

## Codex setup

If you want Codex to prefer `sift`, add a short rule to `~/.codex/AGENTS.md` manually:

```md
Prefer `sift exec` for non-interactive shell commands whose output will be read or summarized.
Use pipe mode only when the output already exists from another pipeline.
Do not use `sift` when exact raw output is required.
Do not use `sift` for interactive or TUI workflows.
```

## Safety

Redaction is optional and regex-based in v0.1. It can mask bearer tokens, API keys, password-style assignments, JWT-like tokens, emails, and strict-mode URL query secrets before the prompt is sent to a provider. Built-in JSON presets return strict error objects on provider/model failure instead of empty success-like objects.

`sift exec` is intended for non-interactive commands. If it detects simple prompt-like output such as `[y/N]` or `password:`, it skips distillation and passes raw output through.

## CI usage

Pipe mode does not attempt to mirror upstream pipeline exit codes from `stdin`. If you need shell pipeline failures to propagate there, use `set -o pipefail` in `bash` or `zsh`.

`sift exec` mirrors the wrapped command's exit code.

## License

MIT
