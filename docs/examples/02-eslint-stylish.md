# Example: ESLint Stylish Output

**Preset:** `lint-failures`
**Case ID:** `eslint-mixed-rules`
**Source type:** `synthetic-derived`

## Before

```text
src/components/Button.tsx

   4:1   error    'React' must be in scope when using JSX  react/react-in-jsx-scope
  12:3   warning  Unexpected console statement             no-console
  27:9   error    'handleClick' is assigned a value but never used  no-unused-vars
  35:1   warning  Prefer const over let                    prefer-const
  47:9   error    Unexpected any. Specify a different type @typescript-eslint/no-explicit-any

src/hooks/useData.ts

  43:9   error    'callback' is assigned a value but never used  no-unused-vars
  59:5   error    Unexpected any. Specify a different type   @typescript-eslint/no-explicit-any
  67:11  warning  Prefer const over let                      prefer-const
  75:3   error    'React' must be in scope when using JSX   react/react-in-jsx-scope

... (96 problems across 4 files)
✖ 96 problems (60 errors, 36 warnings)
  12 errors and 6 warnings are potentially fixable with the --fix option.
```

## After

```text
- Lint failed: 96 problems (60 errors, 36 warnings). 18 problems potentially fixable with --fix.
- no-unused-vars: 28 errors across src/components/Button.tsx, src/hooks/useData.ts, src/pages/Home.tsx.
- react/react-in-jsx-scope: 18 errors across src/components/Button.tsx, src/hooks/useData.ts, src/pages/Home.tsx.
- @typescript-eslint/no-explicit-any: 13 errors across src/components/Button.tsx, src/hooks/useData.ts, src/pages/Home.tsx.
- 2 more rules across 4 files.
```

## Impact

- Raw: `7912` chars / `2046` tokens
- Reduced: `469` chars / `125` tokens
- Reduction: `93.89%`

## Related Files

- Benchmark raw input: [benchmarks/cases/lint-failures/eslint-mixed-rules.raw.txt](../../benchmarks/cases/lint-failures/eslint-mixed-rules.raw.txt)
- Companion raw log: [examples/lint-failures/eslint-mixed-rules.raw.txt](../../examples/lint-failures/eslint-mixed-rules.raw.txt)
- Companion reduced output: [examples/lint-failures/eslint-mixed-rules.reduced.txt](../../examples/lint-failures/eslint-mixed-rules.reduced.txt)
