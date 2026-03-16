# sift

<img src="assets/brand/sift-logo-minimal-monochrome.svg" alt="sift logo" width="120" />

Your AI agent should not be reading 13,000 lines of test output.

`sift` is an open-source CLI that sits between noisy command output and your main model. It captures the output, groups repeated failures into root-cause buckets, and returns a short diagnosis with an anchor, a likely fix, and a decision signal.

In a benchmark on a 640-test Python backend, `sift` reduced token usage by 62%, tool calls by 71%, and wall-clock time by 65%, while reaching the same diagnosis as a raw-agent workflow.

```bash
sift exec --preset test-status -- pytest -q
```

If 125 tests fail for one reason, the agent should pay for that reason once.

## Why `sift` exists

Large failing runs usually look worse than they are.

A suite can report 128 failures, but the real shape may be:
- 125 repeated setup errors
- 3 real code-level failures

Most agents only see raw `stdout` and `stderr`, so they spend expensive tokens reconstructing that grouping step from scratch. `sift` moves that triage step earlier in the pipeline.

## What `sift` returns

Instead of a wall of text, `sift` returns a short diagnosis:
- what failed
- how many distinct failure families exist
- where to look first
- what to do next
- whether to stop, zoom in, or read raw

Example:

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

What changes for the agent:
- raw workflow: figure out the shape of the failure set
- `sift` workflow: act on an already-grouped diagnosis

## How it works

`sift` follows a cheapest-first pipeline:

1. Capture command output.
2. Sanitize sensitive-looking material.
3. Apply local heuristics for known failure shapes.
4. Escalate to a cheaper provider only if needed.
5. Return a short diagnosis to the main agent.

The deepest local coverage today is test debugging, especially `pytest`, with growing support for `vitest` and `jest`.

## The core idea: buckets

A bucket is one distinct root cause, no matter how many tests it affects.

That is the main abstraction inside `sift`. Instead of making an agent reason over 125 repeated tracebacks, `sift` tries to compress them into one actionable bucket with:
- a label
- an affected count
- an anchor
- a likely fix

It also returns a decision signal:
- `stop and act` when the diagnosis is already actionable
- `zoom` when one deeper pass is justified
- raw logs only as a last resort

## Install

Requires Node.js 24 or later.

```bash
npm install -g @bilalimamoglu/sift
```

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

When it cannot be confident, it should tell you to zoom or read raw instead of pretending certainty.

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

## Agent setup

`sift` can install a managed instruction block so coding agents use it by default for long command output:

```bash
sift agent install codex
sift agent install claude
```

Useful related commands:

```bash
sift agent status
sift agent show codex
sift agent remove codex
sift agent remove claude
```

## Benchmark

The current headline benchmark uses a real 640-test Python backend with:
- about 125 repeated setup errors
- 3 contract failures
- about 510 passing tests

Result:
- 62% fewer tokens
- 71% fewer tool calls
- 65% faster wall-clock time

Methodology and caveats live in [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md).

## Docs and maintainer links

- Extra commands and CLI reference: [docs/cli-reference.md](docs/cli-reference.md)
- Benchmark methodology: [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md)
- Release notes example: [release-notes/v0.3.2.md](release-notes/v0.3.2.md)
- Release workflow: bump `package.json`, merge to `main`, then run the `release` workflow manually and enter the package version, for example `0.3.2`

## License

MIT
