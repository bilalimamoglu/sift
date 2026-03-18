# Example: webpack Build Failure

**Preset:** `build-failure`
**Case ID:** `webpack-type-error`
**Source type:** `synthetic-derived`

## Before

```text
assets by status 0 bytes [error] 1 asset

ERROR in ./src/reducers/userSlice.ts
Type 'string' is not assignable to type 'UserStatus'.
Module build failed (from ./node_modules/ts-loader/index.js):

webpack 5.88.0 compiled with 1 error in 4231 ms
```

## After

```text
Build failed: Type 'string' is not assignable to type 'UserStatus' in src/reducers/userSlice.ts. Fix: Fix the type error at the indicated location.
```

## Impact

- Raw: `244` chars / `69` tokens
- Reduced: `147` chars / `36` tokens
- Reduction: `47.83%`

## Related Files

- Benchmark raw input: [benchmarks/cases/build-failure/webpack-type-error.raw.txt](../../benchmarks/cases/build-failure/webpack-type-error.raw.txt)
- Companion raw log: [examples/build-failure/webpack-build-failure-full.raw.txt](../../examples/build-failure/webpack-build-failure-full.raw.txt)
- Companion reduced output: [examples/build-failure/webpack-build-failure-full.reduced.txt](../../examples/build-failure/webpack-build-failure-full.reduced.txt)
