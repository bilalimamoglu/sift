# Example: TypeScript Error Wall

**Preset:** `typecheck-summary`
**Case ID:** `ts-wall-mixed`
**Source type:** `synthetic-derived`

## Before

```text
src/api/client.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/api/client.ts(34,17): error TS2339: Property 'timeout' does not exist on type 'RequestOptions'.
src/api/client.ts(89,11): error TS2345: Argument of type 'undefined' is not assignable to parameter of type 'string'.
src/components/UserCard.tsx(8,3): error TS2741: Property 'id' is missing in type '{}' but required in type 'User'.
src/components/Dashboard.tsx(57,5): error TS2322: Type 'boolean' is not assignable to type 'string'.
src/hooks/useAuth.ts(5,8): error TS2307: Cannot find module '@/lib/auth' or its corresponding type declarations.
src/hooks/useData.ts(31,5): error TS2741: Property 'status' is missing in type 'Partial<DataPayload>' but required in type 'DataPayload'.
src/services/authService.ts(38,7): error TS2322: Type 'number' is not assignable to type 'string'.
src/utils/transform.ts(19,5): error TS6133: 'result' is declared but its value is never read.
src/pages/Home.tsx(51,9): error TS2345: Argument of type 'Event' is not assignable to parameter of type 'SubmitEvent'.
... (96 errors across 8 files)
Found 96 errors in 8 files.
```

## After

```text
- Typecheck failed: 96 errors in 8 files.
- TS2322 (type mismatch): 20 occurrences across src/api/client.ts, src/components/Dashboard.tsx, src/components/UserCard.tsx.
- TS2345 (argument type mismatch): 17 occurrences across src/api/client.ts, src/components/Dashboard.tsx, src/components/UserCard.tsx.
- TS2339 (missing property on type): 15 occurrences across src/api/client.ts, src/components/Dashboard.tsx, src/components/UserCard.tsx.
- 4 more error codes across 8 files.
```

## Impact

- Raw: `10233` chars / `2803` tokens
- Reduced: `476` chars / `120` tokens
- Reduction: `95.72%`

## Related Files

- Benchmark raw input: [benchmarks/cases/typecheck-summary/ts-wall-mixed.raw.txt](../../benchmarks/cases/typecheck-summary/ts-wall-mixed.raw.txt)
- Companion raw log: [examples/typecheck-summary/ts-wall-mixed.raw.txt](../../examples/typecheck-summary/ts-wall-mixed.raw.txt)
- Companion reduced output: [examples/typecheck-summary/ts-wall-mixed.reduced.txt](../../examples/typecheck-summary/ts-wall-mixed.reduced.txt)
