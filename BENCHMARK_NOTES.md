# Benchmark Notes

This file explains the current `test-status` benchmark in simple terms:

- what we are measuring
- what changed over time
- what the current results mean
- how to rerun the benchmark later

It is intentionally plain-language and focused on the `test-status` benchmark, not on every `sift` feature.

## What problem are we measuring?

`sift` is meant to reduce noisy command output before it goes back into a model.

For test debugging, the main question is:

> If a test command prints a huge wall of output, can `sift` turn that into a small, useful first-pass triage answer?

The benchmark measures that for the `test-status` preset.

## Very simple terms

### Fixture

A fixture is a saved test output.

Example:
- one short pytest run with a single DB setup error
- one big full-suite run with many repeated DB errors and a few contract drift failures

We benchmark against fixtures so the results are repeatable.

### Recipe

A recipe is the sequence of commands an agent would try.

Example `sift-first` recipe:
1. run `standard`
2. only if needed, run `focused`
3. only if needed, run `verbose`
4. only if needed, run `--show-raw`

Example `raw-first` recipe:
1. run raw `pytest`
2. maybe rerun with `--tb=no -q`
3. maybe use `grep`, `tail`, or targeted reruns

The benchmark counts how much output those steps would generate.

### Primary metric

The main benchmark metric is:

- how many chars/tokens each output form uses

This is the official benchmark claim.

### Secondary metric

The secondary metric is:

- how many recipe steps are needed
- how many chars/tokens the recipe spends in total

This is supporting evidence, not the main claim.

## The story so far

### Phase 1: `sift` already reduced output very well

From the start, `sift` was good at shrinking large test output.

The problem was not the reduction itself. The problem was that the benchmark harness used brittle substring markers to decide whether `sift` was "done".

That caused false escalation:
- `standard` looked good
- but the harness did not see the exact expected string
- so it escalated to `focused`, then `verbose`, then sometimes `--show-raw`

This made `sift` look worse than it really was.

### Phase 2: structured completion replaced substring markers

We replaced `siftCompletionMarkers` with structured expectations:

- `expectedBuckets`
- `expectedEntitiesAny`
- `expectedMaxDetail`

Now the benchmark asks:

- did `sift` find the right failure families?
- did it capture the key entities?
- was `standard` already enough?

This is much closer to the actual product goal.

### Phase 3: real fixtures became first-class

We added repo-tracked real fixtures captured from a production backend, alongside the synthetic fixtures.

That matters because the real outputs are much larger and noisier than the synthetic ones.

## Current benchmark contract

The benchmark is now designed around this idea:

> Canonical `test-status` fixtures should usually complete at `standard`.

That means:
- `focused` and `verbose` are still measured
- but they are escalation tools, not the normal success path
- `--show-raw` is treated as a last-resort debug escape hatch, not a normal completion state

## Current results

These are the current numbers from the benchmark harness in this repo.

### Synthetic aggregate

- raw: `9320` tokens
- `standard`: `335` tokens
- sift-first recipe: `335` tokens across `4` steps
- raw-first recipe: `9739` tokens across `9` steps

### Synthetic + real aggregate

- raw: `273049` tokens
- `standard`: `600` tokens
- sift-first recipe: `600` tokens across `7` steps
- raw-first recipe: `305434` tokens across `16` steps

### Real fixture highlights

- `single-blocker-short-real`
  - raw: `1366` tokens
  - `standard`: `59` tokens

- `mixed-full-suite-real`
  - raw: `198026` tokens
  - `standard`: `129` tokens

- `snapshot-drift-only-real`
  - raw: `64337` tokens
  - `standard`: `77` tokens

### Important interpretation

The benchmark now shows:

- `sift` is very strong at command-output budget reduction
- canonical fixtures complete at `standard`
- the old over-escalation problem in the harness is gone

## What this does and does not prove

### What it does prove

- `sift` can reduce large test output dramatically
- `test-status` can identify the expected bucket families and key entities on canonical fixtures
- `standard` is usually enough for first-pass triage on those fixtures

### What it does not prove

- it does not prove that every live agent session will use fewer total tokens
- it does not prove that raw `pytest` can never win on a small or familiar failure
- it does not measure end-to-end "agent total tokens" in a reproducible way

That is why the benchmark should be described as:

- a deterministic `test-status` triage benchmark
- primarily about command-output budget reduction

not as a universal claim about every live debugging session.

## Why real fixtures matter

The real fixtures are much bigger than the synthetic fixtures.

That is good for the benchmark because it shows how `sift` behaves under realistic output scale and noise.

At the same time, the synthetic fixtures are still useful because they keep small deterministic regression coverage.

So we keep both:

- synthetic = small, stable regression baseline
- real = fidelity against real pytest output scale

## Where the benchmark lives

Main files:

- `scripts/bench/test-status-ab.ts`
- `test/fixtures/bench/test-status/fixtures.ts`
- `test/fixtures/bench/test-status/real-fixtures.ts`
- `test/fixtures/bench/test-status/real/`
- `test/bench.script.test.ts`

## How to rerun it

Run the synthetic baseline:

```bash
npm run bench:test-status-ab
```

Run only the real fixtures:

```bash
npm run bench:test-status-ab -- --only-real
```

Run synthetic + real together:

```bash
npm run bench:test-status-ab -- --real
```

Recommended validation commands:

```bash
npm run typecheck
npm run test:coverage
npm run bench:test-status-ab
npm run bench:test-status-ab -- --real
```

## Short takeaway

The current benchmark says:

- `sift` is clearly winning on command-output budget
- the benchmark harness is now fairer than it was before
- `standard` is the intended happy path
- `focused`, `verbose`, and `--show-raw` are escalation tools, not the default route

If a future change makes canonical fixtures stop completing at `standard`, that should be treated as a benchmark regression.
