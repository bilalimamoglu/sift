# Example: Vitest Mixed Failures

**Preset:** `test-status`
**Fixture:** `vitest-mixed-js`
**Source type:** `synthetic-derived`

## Before

```text
 RUN  v2.1.0 /repo

 ❯ src/components/button.test.ts > Button > renders primary FAILED [ 25%]
 ❯ src/hooks/timeout.test.ts > useSlowHook > resolves FAILED [ 50%]
 ❯ src/setup/auth.test.ts ERROR [ 75%]

⎯⎯⎯ Failed Tests 2 ⎯⎯⎯

 FAIL  src/components/button.test.ts > Button > renders primary
Error: Snapshot `Button > renders primary` mismatched
❯ src/components/button.test.ts:42:19

 FAIL  src/hooks/timeout.test.ts > useSlowHook > resolves
Error: Test timed out in 5000ms.
❯ src/hooks/timeout.test.ts:21:9

⎯⎯⎯ Failed Suites 1 ⎯⎯⎯

 FAIL  src/setup/auth.test.ts [ src/setup/auth.test.ts ]
Error: Failed to resolve import "@/missing-client" from "src/setup/auth.test.ts". Does the file exist?
❯ src/setup/auth.test.ts:1:1
```

## After

```text
- Tests did not pass.
- 2 tests failed.
- Import/dependency blocker: at least 1 visible failure are caused by missing dependencies during test collection.
- Anchor: src/setup/auth.test.ts lines 1-6
- Fix: Install @/missing-client and rerun the affected tests.
- Snapshot mismatches: 1 snapshot expectation is out of date with current output.
- Anchor: src/components/button.test.ts lines 37-47
- Fix: Update the snapshots if these output changes are intentional.
- Timeout failures: 1 test exceeded the configured timeout threshold.
- Anchor: src/hooks/timeout.test.ts lines 16-26
- Fix: Check for deadlocks, slow setup, or increase the timeout threshold before rerunning.
- Decision: read source next. Do not escalate unless exact traceback lines are still needed.
- Likely owner: test or project configuration
- Next: Read src/setup/auth.test.ts lines 1-6 first; it is the first visible failing module in this missing dependency bucket.
- Stop signal: diagnosis complete; raw not needed.
```

## Impact

- Raw: `823` chars / `269` tokens
- Reduced: `989` chars / `222` tokens
- Reduction: `17.47%`

## Related Files

- Benchmark raw input: [test/fixtures/bench/test-status/synthetic/vitest-mixed-js.txt](../../test/fixtures/bench/test-status/synthetic/vitest-mixed-js.txt)
- Companion rendered output: [examples/test-status/vitest-mixed-js.standard.txt](../../examples/test-status/vitest-mixed-js.standard.txt)
