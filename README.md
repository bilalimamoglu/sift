# sift

[![npm version](https://img.shields.io/npm/v/@bilalimamoglu/sift)](https://www.npmjs.com/package/@bilalimamoglu/sift)
[![license](https://img.shields.io/github/license/bilalimamoglu/sift)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/bilalimamoglu/sift/ci.yml?branch=main&label=CI)](https://github.com/bilalimamoglu/sift/actions/workflows/ci.yml)

<img src="assets/brand/sift-logo-minimal-teal-default.svg" alt="sift logo" width="140" />

Your AI agent should not be reading 13,000 lines of test output.

If 125 tests fail for one reason, it should pay for that reason once.

`sift` turns noisy command output into a short, structured diagnosis for coding agents, so they spend fewer tokens, cost less to run, and move through debug loops faster.

Instead of feeding an agent thousands of lines of logs, you give it:
- the root cause
- where it happens
- what to fix
- what to do next

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

On the largest real fixture in the benchmark:
`198K` raw-output tokens -> `129` `standard` tokens.

Same diagnosis. Far less work.

## What it is

`sift` sits between a noisy command and a coding agent. It captures output, groups repeated failures into root-cause buckets, and returns a short diagnosis with an anchor, a likely fix, and a decision signal.

## Install

```bash
npm install -g @bilalimamoglu/sift
```

Requires Node.js 20+.

## Try it in 60 seconds

If you already have an API key, you can try `sift` without any setup wizard:

```bash
export OPENAI_API_KEY=your_openai_api_key
sift exec --preset test-status -- pytest -q
```

You can also use a freeform prompt for non-test output:

```bash
sift exec "what changed?" -- git diff
```

## Set it up for daily use

Guided setup writes a machine-wide config, verifies the provider, and makes the CLI easier to use day to day:

```bash
sift config setup
sift doctor
```

Config lives at `~/.config/sift/config.yaml`. A repo-local `sift.config.yaml` can override it later.

If you want your coding agent to use `sift` automatically, install the managed instruction block too:

```bash
sift agent install codex
sift agent install claude
```

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

## Why it helps

The core abstraction is a **bucket**: one distinct root cause, no matter how many tests it affects.

Instead of making an agent reason over 125 repeated tracebacks, `sift` compresses them into one actionable bucket with:
- a label
- an affected count
- an anchor
- a likely fix
- a decision signal

That changes the agent's job from "figure out what happened" to "act on the diagnosis."

## How it works

`sift` follows a cheapest-first pipeline:

1. Capture command output.
2. Sanitize sensitive-looking material.
3. Apply local heuristics for known failure shapes.
4. Escalate to a cheaper provider only if needed.
5. Return a short diagnosis to the main agent.

It also returns a decision signal:
- `stop and act` when the diagnosis is already actionable
- `zoom` when one deeper pass is justified
- raw logs only as a last resort

For recognized formats, local heuristics can fully handle the output and skip the provider entirely.

The deepest local coverage today is test debugging, especially `pytest`, with growing support for `vitest` and `jest`. Other presets cover typecheck walls, lint failures, build errors, audit output, and Terraform risk detection.

## Built-in presets

Every preset runs local heuristics first. When the heuristic confidently handles the output, the provider is never called.

| Preset | Heuristic | What it does |
|--------|-----------|-------------|
| `test-status` | Deep | Bucket/anchor/decision system for pytest, vitest, jest. 30+ failure patterns, confidence-gated stop/zoom decisions. |
| `typecheck-summary` | Deterministic | Parses `tsc` output (standard and pretty formats), groups by error code, returns max 5 bullets. |
| `lint-failures` | Deterministic | Parses ESLint stylish output, groups by rule, distinguishes errors from warnings, detects fixable hints. |
| `audit-critical` | Deterministic | Extracts high/critical vulnerabilities from `npm audit` or similar. |
| `infra-risk` | Deterministic | Detects destructive signals in `terraform plan` output. Returns pass/fail verdict. |
| `build-failure` | Deterministic-first | Extracts the first concrete build error for recognized webpack, esbuild/Vite, Cargo, Go, GCC/Clang, and `tsc --build` output; falls back to the provider for unsupported formats. |
| `diff-summary` | Provider | Summarizes changes and risks in diff output. |
| `log-errors` | Provider | Extracts top error signals from log output. |

Presets marked **Deterministic** bypass the provider entirely for recognized output formats. Presets marked **Deterministic-first** try a local heuristic first and fall back to the provider only when the captured output is unsupported or ambiguous. Presets marked **Provider** always call the LLM but benefit from input sanitization and truncation.

```bash
sift exec --preset typecheck-summary -- npx tsc --noEmit
sift exec --preset lint-failures -- npx eslint src/
sift exec --preset build-failure -- npm run build
sift exec --preset audit-critical -- npm audit
sift exec --preset infra-risk -- terraform plan
```

On an interactive terminal, `sift` also shows a small stderr footer so humans can see whether the provider was skipped:

```text
[sift: heuristic • LLM skipped • summary 47ms]
[sift: provider • LLM used • 380 tokens • summary 1.2s]
```

Suppress the footer with `--quiet`:

```bash
sift exec --preset typecheck-summary --quiet -- npx tsc --noEmit
```

## Strongest today

`sift` is strongest when output is:
- long
- repetitive
- triage-heavy
- shaped by a small number of shared root causes

Best fits today:
- large `pytest`, `vitest`, or `jest` runs
- `tsc` type errors and `eslint` lint failures
- build failures from webpack, esbuild/Vite, Cargo, Go, GCC/Clang
- `npm audit` and `terraform plan`
- repeated CI blockers
- noisy diffs and log streams

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

`sift rerun --remaining` narrows automatically for cached `pytest` runs.

For cached `vitest` and `jest` runs, it reruns the original full command and keeps the diagnosis focused on what still fails relative to the cached baseline.

For other runners, rerun a narrowed command manually with `sift exec --preset test-status -- <narrowed command>`.

```bash
sift agent status
sift agent show claude
sift agent remove claude
```

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

The table above is the single-fixture reduction story: the largest real test log in the benchmark shrank from `198026` raw tokens to `129` `standard` tokens.

The end-to-end workflow benchmark is a different metric:
- `62%` fewer total debugging tokens
- `71%` fewer tool calls
- `65%` faster wall-clock time

Both matter. The table shows how aggressively `sift` can compress one large noisy run. The workflow numbers show how that compounds across a full debug loop.

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
- Worked examples: [docs/examples](docs/examples)
- Benchmark methodology: [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md)
- Release notes: [release-notes](release-notes)

## License

MIT
