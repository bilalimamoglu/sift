# Full-Length Example Gallery

These examples are the long-form companion to [docs/examples](../docs/examples).

- `docs/examples/` stays short and readable for product storytelling.
- `examples/` keeps fuller raw logs plus the reduced output that `sift` produces from them.
- The goal is to show what a human or agent would actually be spared from reading.

## Included examples

- [typecheck-summary/ts-wall-mixed.raw.txt](typecheck-summary/ts-wall-mixed.raw.txt)
- [lint-failures/eslint-mixed-rules.raw.txt](lint-failures/eslint-mixed-rules.raw.txt)
- [build-failure/vite-build-failure-full.raw.txt](build-failure/vite-build-failure-full.raw.txt)
- [audit-critical/npm-audit-mixed-severity-full.raw.txt](audit-critical/npm-audit-mixed-severity-full.raw.txt)
- [infra-risk/terraform-destructive-plan-full.raw.txt](infra-risk/terraform-destructive-plan-full.raw.txt)

## Notes

- Source type for all current examples is `synthetic-derived`.
- The grouped presets intentionally include one noisy wall case each.
- The reduced outputs were captured from the current heuristics at authoring time.
