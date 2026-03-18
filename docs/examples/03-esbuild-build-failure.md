# Example: esbuild Build Failure

**Preset:** `build-failure`
**Case ID:** `esbuild-missing-module`
**Source type:** `synthetic-derived`

## Before

```text
✘ [ERROR] Could not resolve "react-query"

    src/hooks/usePosts.ts:3:22:
      3 │ import { useQuery } from "react-query";
        ╵                         ~~~~~~~~~~~~

  You can mark the path "react-query" as external to exclude it from the bundle, which will remove
  this error and leave the unresolved path in the output.
```

## After

```text
Build failed: Could not resolve "react-query" in src/hooks/usePosts.ts:3. Fix: Install the missing package or fix the import path.
```

## Impact

- Raw: `339` chars / `83` tokens
- Reduced: `130` chars / `31` tokens
- Reduction: `62.65%`

## Related Files

- Benchmark raw input: [benchmarks/cases/build-failure/esbuild-missing-module.raw.txt](../../benchmarks/cases/build-failure/esbuild-missing-module.raw.txt)
- Companion raw log: [examples/build-failure/vite-build-failure-full.raw.txt](../../examples/build-failure/vite-build-failure-full.raw.txt)
- Companion reduced output: [examples/build-failure/vite-build-failure-full.reduced.txt](../../examples/build-failure/vite-build-failure-full.reduced.txt)
