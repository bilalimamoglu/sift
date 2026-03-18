# Full-Length Example Gallery

These examples are the long-form companion to [docs/examples](../docs/examples).

- `docs/examples/` stays short and readable for product storytelling.
- `examples/` keeps fuller raw logs plus the reduced output that `sift` produces from them.
- The goal is to show what a human or agent would actually be spared from reading.

## Included examples

- [typecheck-summary/ts-wall-mixed.raw.txt](typecheck-summary/ts-wall-mixed.raw.txt)
- [lint-failures/eslint-mixed-rules.raw.txt](lint-failures/eslint-mixed-rules.raw.txt)
- [build-failure/esbuild-missing-module-full.raw.txt](build-failure/esbuild-missing-module-full.raw.txt)
- [build-failure/webpack-build-failure-full.raw.txt](build-failure/webpack-build-failure-full.raw.txt)
- [build-failure/vite-import-analysis-full.raw.txt](build-failure/vite-import-analysis-full.raw.txt)
- [build-failure/vite-build-failure-full.raw.txt](build-failure/vite-build-failure-full.raw.txt)
- [audit-critical/npm-audit-mixed-severity-full.raw.txt](audit-critical/npm-audit-mixed-severity-full.raw.txt)
- [infra-risk/terraform-destructive-plan-full.raw.txt](infra-risk/terraform-destructive-plan-full.raw.txt)
- [test-status/mixed-full-suite-real.standard.txt](test-status/mixed-full-suite-real.standard.txt)
- [test-status/mixed-full-suite-real.diagnose.json](test-status/mixed-full-suite-real.diagnose.json)
- [test-status/vitest-mixed-js.standard.txt](test-status/vitest-mixed-js.standard.txt)

## Notes

- Most long-form examples are `synthetic-derived`; `test-status` companions may be sourced from repo-captured fixture logs.
- The grouped presets intentionally include one noisy wall case each.
- The reduced outputs were captured from the current heuristics at authoring time.
- `docs/examples/` pages are benchmark-backed showcase pages; `examples/` keeps the longer companion logs.
- `examples/test-status/` keeps frozen rendered companions; the raw inputs live under `test/fixtures/bench/test-status/`.
