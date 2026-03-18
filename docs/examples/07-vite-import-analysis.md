# Example: Vite Import Analysis Failure

**Preset:** `build-failure`
**Case ID:** `vite-import-analysis-missing-import`
**Source type:** `synthetic-derived`

## Before

```text
vite v5.4.11 building for production...
transforming (1) src/main.ts
transforming (2) src/app/AppShell.tsx
transforming (3) src/routes/root.tsx
transforming (4) src/routes/dashboard.tsx
[plugin:vite:import-analysis] Failed to resolve import "@/lib/missing" from "src/routes/dashboard.tsx". Does the file exist?
transforming (5) src/routes/settings.tsx
error during build:
```

## After

```text
Build failed: Failed to resolve import "@/lib/missing" in src/routes/dashboard.tsx. Fix: Install the missing package or fix the import path.
```

## Impact

- Raw: `372` chars / `99` tokens
- Reduced: `140` chars / `31` tokens
- Reduction: `68.69%`

## Related Files

- Benchmark raw input: [benchmarks/cases/build-failure/vite-import-analysis-missing-import.raw.txt](../../benchmarks/cases/build-failure/vite-import-analysis-missing-import.raw.txt)
- Companion raw log: [examples/build-failure/vite-import-analysis-full.raw.txt](../../examples/build-failure/vite-import-analysis-full.raw.txt)
- Companion reduced output: [examples/build-failure/vite-import-analysis-full.reduced.txt](../../examples/build-failure/vite-import-analysis-full.reduced.txt)
