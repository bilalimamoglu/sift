# sift

[![npm version](https://img.shields.io/npm/v/@bilalimamoglu/sift)](https://www.npmjs.com/package/@bilalimamoglu/sift)
[![license](https://img.shields.io/github/license/bilalimamoglu/sift)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/bilalimamoglu/sift/ci.yml?branch=main&label=CI)](https://github.com/bilalimamoglu/sift/actions/workflows/ci.yml)

<img src="assets/brand/sift-logo-minimal-teal-default.svg" alt="sift logo" width="140" />

Your AI agent should not be reading 13,000 lines of test output.

**Before:** 128 failures, 198K tokens, 16 tool calls, agent reconstructs the failure shape from scratch.
**After:** 6 lines, 129 tokens, 4 tool calls, agent acts on a grouped diagnosis immediately.

```bash
sift exec --preset test-status -- pytest -q
```

```text
- Tests did not pass.
- 3 tests failed. 125 errors occurred.
- Shared blocker: 125 errors share the same root cause - a missing test environment variable.
  Anchor: tests/conftest.py
  Fix: Set the required env var before rerunning DB-isolated tests.
- Contract drift: 3 snapshot tests are out of sync with the current API or model state.
  Anchor: tests/contracts/test_feature_manifest_freeze.py
  Fix: Regenerate the snapshots if the changes are intentional.
- Decision: stop and act.
```

If 125 tests fail for one reason, the agent should pay for that reason once.

## Who is this for

Developers using coding agents — Claude Code, Codex, Cursor, Windsurf, Copilot, or any LLM-driven workflow that runs shell commands and reads the output.

`sift` sits between the command and the agent. It captures noisy output, groups repeated failures into root-cause buckets, and returns a short diagnosis with an anchor, a likely fix, and a decision signal. The agent gets a map instead of a wall of text.

## Install

```bash
npm install -g @bilalimamoglu/sift
```

Requires Node.js 20+.

## Quick start

Guided setup writes a machine-wide config and verifies the provider:

```bash
sift config setup
sift doctor
```

Config lives at `~/.config/sift/config.yaml`. A repo-local `sift.config.yaml` can override it later.

Then run noisy commands through `sift`:

```bash
sift exec --preset test-status -- <test command>
sift exec "what changed?" -- git diff
sift exec --preset audit-critical -- npm audit
sift exec --preset infra-risk -- terraform plan
```

Useful flags:
- `--dry-run` to preview the reduced input and prompt without calling a provider
- `--show-raw` to print captured raw output to `stderr`
- `--fail-on` to let reduced results fail CI for commands such as `npm audit` or `terraform plan`

If you prefer environment variables instead of setup:

```bash
# OpenAI
export SIFT_PROVIDER=openai
export SIFT_BASE_URL=https://api.openai.com/v1
export SIFT_MODEL=gpt-5-nano
export OPENAI_API_KEY=your_openai_api_key

# OpenRouter
export SIFT_PROVIDER=openrouter
export OPENROUTER_API_KEY=your_openrouter_api_key

# Any OpenAI-compatible endpoint
export SIFT_PROVIDER=openai-compatible
export SIFT_BASE_URL=https://your-endpoint/v1
export SIFT_PROVIDER_API_KEY=your_api_key
```

## How it works

`sift` follows a cheapest-first pipeline:

1. Capture command output.
2. Sanitize sensitive-looking material.
3. Apply local heuristics for known failure shapes.
4. Escalate to a cheaper provider only if needed.
5. Return a short diagnosis to the main agent.

The core abstraction is a **bucket** — one distinct root cause, no matter how many tests it affects. Instead of making an agent reason over 125 repeated tracebacks, `sift` compresses them into one actionable bucket with a label, an affected count, an anchor, and a likely fix.

It also returns a decision signal:
- `stop and act` when the diagnosis is already actionable
- `zoom` when one deeper pass is justified
- raw logs only as a last resort

The deepest local coverage today is test debugging, especially `pytest`, with growing support for `vitest` and `jest`.

## Test debugging workflow

This is where `sift` is strongest today.

Think of it like this:
- `standard` = map
- `focused` = zoom
- raw traceback = last resort

Typical loop:

```bash
sift exec --preset test-status -- <test command>
sift rerun
sift rerun --remaining --detail focused
```

If `standard` already gives you the root cause, anchor, and fix, stop there and act.

`sift rerun --remaining` currently supports only cached `pytest` or `python -m pytest` runs. For other runners, rerun a narrowed command manually with `sift exec --preset test-status -- <narrowed command>`.

## Agent setup

`sift` can install a managed instruction block so coding agents use it by default for long command output:

```bash
sift agent install claude
sift agent install codex
```

This writes a tuned set of rules into your agent's config (CLAUDE.md, AGENTS.md, etc.) so the agent routes noisy commands through `sift` automatically — no manual prompting needed.

```bash
sift agent status
sift agent show claude
sift agent remove claude
```

## Where `sift` helps most

`sift` is strongest when output is:
- long
- repetitive
- triage-heavy
- shaped by a small number of root causes

Good fits:
- large `pytest`, `vitest`, or `jest` runs
- repeated CI blockers
- `npm audit`
- `terraform plan`
- noisy diffs and log streams

## Where it helps less

`sift` adds less value when:
- the output is already short and obvious
- the command is interactive or TUI-based
- the exact raw log matters
- the output does not expose enough evidence for reliable grouping

When it cannot be confident, it tells you to zoom or read raw instead of pretending certainty.

## Benchmark

On a real 640-test Python backend (125 repeated setup errors, 3 contract failures, 510 passing tests):

| Metric | Raw agent | sift-first | Reduction |
|--------|-----------|------------|-----------|
| Tokens | 305K | 600 | 99.8% |
| Tool calls | 16 | 7 | 56% |
| Diagnosis | Same | Same | — |

The headline numbers (62% token reduction, 71% fewer tool calls, 65% faster) come from the end-to-end wall-clock comparison. The table above shows the token-level reduction on the largest real fixture.

Methodology and caveats live in [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md).

## Configuration

Inspect and validate config with:

```bash
sift config show
sift config show --show-secrets
sift config validate
```

To switch between saved providers without editing files:

```bash
sift config use openai
sift config use openrouter
```

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

## Docs

- CLI reference: [docs/cli-reference.md](docs/cli-reference.md)
- Benchmark methodology: [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md)

## License

MIT
