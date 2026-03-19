# sift

[![npm version](https://img.shields.io/npm/v/@bilalimamoglu/sift)](https://www.npmjs.com/package/@bilalimamoglu/sift)
[![license](https://img.shields.io/github/license/bilalimamoglu/sift)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/bilalimamoglu/sift/ci.yml?branch=main&label=CI)](https://github.com/bilalimamoglu/sift/actions/workflows/ci.yml)

Turn 13,000 lines of test output into 2 root causes.

Your agent reads a diagnosis, not a log file.

<p align="center">
  <img src="assets/readme/test-status-demo.gif" alt="sift turning a pytest failure wall into a short diagnosis" width="960" />
</p>

## Before / After

128 test failures. 13,000 lines of logs. The agent reads all of it.

With `sift`, it reads this instead:

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

Same diagnosis. One run compressed from 198,000 tokens to 129.

## Not just tests

The same idea applies across noisy dev workflows:

- **Type errors** → grouped by error code, no model call
- **Lint output** → grouped by rule, no model call
- **Build failures** → first real error from webpack, esbuild/Vite, Cargo, Go, GCC/Clang
- **`npm audit`** → high/critical vulnerabilities only, no model call
- **`terraform plan`** → destructive risk detection, no model call
- **Diffs and logs** → compressed through a cheaper model before reaching your agent

## Install

```bash
npm install -g @bilalimamoglu/sift
```

Requires Node.js 20+.

## Try it

```bash
sift exec --preset test-status -- pytest -q
sift exec --preset test-status -- npx vitest run
sift exec --preset test-status -- npx jest
```

Other workflows:

```bash
sift exec --preset typecheck-summary -- npx tsc --noEmit
sift exec --preset lint-failures -- npx eslint src/
sift exec --preset build-failure -- npm run build
sift exec --preset audit-critical -- npm audit
sift exec --preset infra-risk -- terraform plan
sift exec "what changed?" -- git diff
```

## How it works

`sift` sits between a noisy command and a coding agent.

1. Capture output.
2. Run local heuristics for known failure shapes.
3. If heuristics are confident, return the diagnosis. No model call.
4. If not, call a cheaper model — not your agent's.

The agent gets the root cause, where it happens, and what to do next.

So your agent spends tokens fixing, not reading.

## Built-in presets

Every preset runs local heuristics first. When the heuristic handles the output, the provider is never called.

| Preset | What it does |
|--------|-------------|
| `test-status` | Groups pytest, vitest, jest failures into root-cause buckets with anchors and fix suggestions. 30+ failure patterns. |
| `typecheck-summary` | Parses `tsc` output, groups by error code, returns max 5 bullets. No model call. |
| `lint-failures` | Parses ESLint output, groups by rule, detects fixable hints. No model call. |
| `build-failure` | Extracts first concrete error from webpack, esbuild/Vite, Cargo, Go, GCC/Clang, `tsc --build`. Falls back to model for unsupported formats. |
| `audit-critical` | Extracts high/critical vulnerabilities from `npm audit`. No model call. |
| `infra-risk` | Detects destructive signals in `terraform plan`. No model call. |
| `diff-summary` | Summarizes changes and risks in diff output. |
| `log-errors` | Extracts top error signals from log output. |

## Benchmark

End-to-end debug loop on a real 640-test Python backend (125 repeated setup errors, 3 contract failures, 510 passing tests):

| Metric | Without sift | With sift | Reduction |
|--------|-------------|-----------|-----------|
| Tokens | 52,944 | 20,049 | 62% fewer |
| Tool calls | 40.8 | 12 | 71% fewer |
| Wall-clock time | 244s | 85s | 65% faster |
| Commands | 15.5 | 6 | 61% fewer |
| Diagnosis | Same | Same | — |

Methodology and caveats: [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md)

## Test debugging workflow

Think of it like this:
- `standard` = map
- `focused` = zoom
- raw traceback = last resort

```bash
sift exec --preset test-status -- <test command>
sift rerun
sift rerun --remaining --detail focused
```

If `standard` already gives you the root cause, anchor, and fix — stop and act.

`sift rerun --remaining` narrows automatically for cached `pytest` runs. For `vitest` and `jest`, it reruns the full command and keeps diagnosis focused on what still fails.

## Setup

Guided setup writes a config, verifies the provider, and makes daily use easier:

```bash
sift config setup
sift doctor
```

To wire `sift` into your coding agent automatically:

```bash
sift agent install claude
sift agent install codex
```

Config details: [docs/cli-reference.md](docs/cli-reference.md)

## Docs

- CLI reference: [docs/cli-reference.md](docs/cli-reference.md)
- Worked examples: [docs/examples](docs/examples)
- Benchmark methodology: [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md)
- Release notes: [release-notes](release-notes)

## License

MIT
