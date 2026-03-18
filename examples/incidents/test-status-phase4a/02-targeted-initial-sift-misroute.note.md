# Missing historical capture

The initial `sift exec --preset test-status -- npx vitest run test/heuristics.unit.test.ts test/bench.script.test.ts test/test-status.showcase.test.ts test/examples.sync.test.ts` output that misrouted the failure summary was not recoverable by the time the fix landed.

This omission is intentional, not forgotten.

The raw failing command output is still preserved in:

- `01-targeted-heuristics-vitest.raw.txt`

The key historical behavior that prompted this note:

- the first `sift` pass did not surface the exact `fix_hint` drift as the primary issue
- raw `vitest` output was needed to identify the failing expectation precisely
