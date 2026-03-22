<div align="center">

<img src="assets/brand/sift-logo-minimal-teal-default.svg" alt="sift logo" width="220" />

# sift

### Turn noisy command output into a short, actionable first pass for your coding agent

**Local heuristics first. Group repeated failures into likely root causes and next steps before your agent reads the full log.**

[![npm version](https://img.shields.io/npm/v/@bilalimamoglu/sift)](https://www.npmjs.com/package/@bilalimamoglu/sift)
[![license](https://img.shields.io/github/license/bilalimamoglu/sift)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/bilalimamoglu/sift/ci.yml?branch=main&label=CI)](https://github.com/bilalimamoglu/sift/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

<br />

### Get Started

```bash
npm install -g @bilalimamoglu/sift
```

<sub>Best today on noisy pytest, vitest, jest, `tsc`, ESLint, common build failures, `npm audit`, and `terraform plan` output.</sub>

</div>

---

## Why Sift?

When an agent hits noisy output, it can eventually make sense of the log wall, but it wastes time and tokens getting there.

`sift` narrows that output locally first. It groups repeated failures, surfaces likely root causes, and points to the next useful step so your agent starts from signal instead of raw noise.

It is not a generic repo summarizer, not a shell telemetry product, and not a benchmark dashboard. It is a local-first triage layer for noisy command output in coding-agent workflows.

Turn 13,000 lines of test output into 2 root causes.

<p align="center">
  <img src="assets/readme/test-status-demo.gif" alt="sift turning a pytest failure wall into a short, actionable first pass" width="960" />
</p>

With `sift`, the same run becomes:

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

In one large `test-status` benchmark fixture, `sift` compressed 198,026 raw output tokens to 129. That is scoped proof for a noisy test-debugging case, not a promise that every preset behaves the same way.

---

## Quick Start

### 1. Install

```bash
npm install -g @bilalimamoglu/sift
```

Requires Node.js 20+.

### 2. Try the main workflow

If you are new, start here and ignore hook beta and native surfaces for now:

```bash
sift exec --preset test-status -- pytest -q
```

Other common entry points:

```bash
sift exec --preset test-status -- npx vitest run
sift exec --preset test-status -- npx jest
sift exec "what changed?" -- git diff
```

### 3. Zoom only if needed

Think of the workflow like this:

- `standard` = map
- `focused` = zoom
- raw traceback = last resort

```bash
sift rerun
sift rerun --remaining --detail focused
```

If `standard` already gives you the likely root cause, anchor, and fix, stop there and act.

---

## Benchmark Results

The output reduction above measures a single command's raw output. The table below measures one replayed end-to-end debug loop: how many tokens, tool calls, and seconds the agent spent to reach the same outcome in that benchmarked scenario.

Real debug loop on a 640-test Python backend with 124 repeated setup errors, 3 contract failures, and 511 passing tests:

| Metric | Without sift | With sift | Reduction |
|--------|-------------:|----------:|----------:|
| Tokens | 52,944 | 20,049 | 62% fewer |
| Tool calls | 40.8 | 12 | 71% fewer |
| Wall-clock time | 244s | 85s | 65% faster |
| Commands | 15.5 | 6 | 61% fewer |
| Outcome | Same | Same | Same outcome |

Same outcome, less agent thrash.

Methodology and caveats: [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md)

---

## How It Works

`sift` keeps the explanation simple:

1. **Capture output.** Run the noisy command or accept already-existing piped output.
2. **Run local heuristics.** Detect known failure shapes first so common cases stay cheap and deterministic.
3. **Return a useful first pass.** When heuristics are confident, `sift` gives the agent grouped failures, likely root causes, and the next step.
4. **Fall back only when needed.** If heuristics are not enough, `sift` uses a cheaper model instead of spending your main agent budget.

Your agent spends tokens fixing, not reading.

---

## Key Features

<table>
<tr>
<td width="33%" valign="top">

### Test Failure Guidance
Collapse repeated pytest, vitest, and jest failures into grouped issues with likely root causes, anchors, and fix hints.

</td>
<td width="33%" valign="top">

### Typecheck and Lint Guidance
Group noisy `tsc` and ESLint output into the few issues that actually matter instead of dumping the whole log back into the model.

</td>
<td width="33%" valign="top">

### Build Failure Extraction
Pull out the first concrete error from webpack, esbuild/Vite, Cargo, Go, GCC/Clang, and similar build output.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### Audit and Infra Risk
Surface high-impact `npm audit` findings and destructive `terraform plan` signals without making the agent read everything.

</td>
<td width="33%" valign="top">

### Heuristic-First by Default
Every built-in preset tries local parsing first. When the heuristic handles the output, no provider call is needed.

</td>
<td width="33%" valign="top">

### Agent and Automation Friendly
Use `sift` in Codex, Claude, CI, hooks, or shell scripts when you want downstream tooling to receive a short first pass instead of the raw log wall.

</td>
</tr>
</table>

---

## Presets

| Preset | What it does | Needs provider? |
|--------|--------------|:---------------:|
| `test-status` | Groups pytest, vitest, and jest failures into root-cause buckets with anchors and fix suggestions. | No |
| `typecheck-summary` | Parses `tsc` output and groups issues by error code. | No |
| `lint-failures` | Parses ESLint output and groups failures by rule. | No |
| `build-failure` | Extracts the first concrete build error from common toolchains. | Fallback only |
| `contract-drift` | Detects explicit snapshot, golden, OpenAPI, manifest, or generated-artifact drift without broadening into generic repo analysis. | Fallback only |
| `audit-critical` | Pulls high and critical `npm audit` findings. | No |
| `infra-risk` | Detects destructive signals in `terraform plan`. | No |
| `diff-summary` | Summarizes change sets and likely risks in diff output. | Yes |
| `log-errors` | Extracts the strongest error signals from noisy logs. | Fallback only |

When output already exists in a pipeline, use pipe mode instead of `exec`:

```bash
pytest -q 2>&1 | sift preset test-status
npm audit 2>&1 | sift preset audit-critical
```

---

## Setup and Agent Integration

If you want deeper integration after the first successful `sift exec` run, start with:

```bash
sift install
```

Most built-in presets run entirely on local heuristics with no API key required. If you want deeper fallback for ambiguous cases, `sift` also supports OpenAI-compatible and OpenRouter-compatible endpoints.

During install, pick the mode that matches reality:
- `agent-escalation`: `sift` gives the first answer, then your agent keeps going
- `provider-assisted`: `sift` itself can ask a cheap fallback model when needed
- `local-only`: keep everything local

Runtime-native files are small guidance surfaces, not a second execution system:
- Codex: managed `AGENTS.md` block plus a generated `SKILL.md`
- Claude: managed `CLAUDE.md` block plus a generated `.claude/commands/sift/` command pack
- Cursor: optional `.cursor/skills/sift/SKILL.md` path when you want an explicit native Cursor skill

Default rule:
- use `sift exec` for the normal first pass
- use `sift hook` only as an optional beta shortcut for a tiny known-command set

Optional local evidence surfaces:

```bash
sift gain
sift discover
```

- `gain` shows local, metadata-only first-pass history
- `discover` stays quiet unless your own local history is strong enough to justify a concrete suggestion

If you want the full install, ownership, and touched-files details, see [docs/cli-reference.md](docs/cli-reference.md). The short version: `sift` does **not** write shell rc files, PATH entries, git hooks, or arbitrary repo files during install.

If you want this repo's tracked pre-push verification hook to actually run on your machine, you still need to activate it once:

```bash
npm run setup:hooks
```

---

## Test Debugging Workflow

For noisy test failures, start with the `test-status` preset and let `standard` be the default stop point.

```bash
sift exec --preset test-status -- <test command>
sift rerun
sift rerun --remaining --detail focused
sift rerun --remaining --detail verbose --show-raw
```

Useful rules of thumb:

- If `standard` ends with `Decision: stop and act`, go read source and fix the issue.
- Use `sift rerun` after a change to refresh the same test command at `standard`.
- Use `sift rerun --remaining` to zoom into what still fails after the first pass.
- Treat raw traceback as the last resort, not the starting point.

For machine branching or automation, `test-status` also supports diagnose JSON:

```bash
sift exec --preset test-status --goal diagnose --format json -- pytest -q
sift rerun --goal diagnose --format json
```

Diagnose JSON is summary-first on purpose. If `read_targets.anchor_kind=traceback` and `read_targets.context_hint.kind=exact_window`, read that narrow range first. If the read target is lower-confidence or `search_only`, treat it as a representative hint rather than exact root-cause proof.

---

## Limitations

- sift adds the most value when output is long, repetitive, and shaped by a small number of root causes. For short, obvious failures it may not save much.
- The deepest local heuristic coverage is in test debugging (pytest, vitest, jest). Other presets have solid heuristics but less depth.
- sift does not help with interactive or TUI-based commands.
- sift is not a generic repo summarizer or broad mismatch detector. It works best when the command output itself carries strong failure or drift evidence.
- When heuristics cannot explain the output confidently, sift either falls back to a provider or returns the strongest local first pass it can, depending on how you choose to use it.

---

## Docs

- CLI reference: [docs/cli-reference.md](docs/cli-reference.md)
- Worked examples: [docs/examples](docs/examples)
- Benchmark methodology: [BENCHMARK_NOTES.md](BENCHMARK_NOTES.md)
- Contributing and development notes: [CONTRIBUTING.md](CONTRIBUTING.md)
- Release notes: [release-notes](release-notes)

---

## License

MIT

---

<div align="center">

Local-first output guidance for coding agents.

[Report Bug](https://github.com/bilalimamoglu/sift/issues) | [Request Feature](https://github.com/bilalimamoglu/sift/issues)

</div>
