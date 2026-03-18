# Test-Status Phase 4a Historical Incidents

These files are frozen captures of problems encountered while implementing Phase 4a.

- They are not current showcase examples.
- They are not kept in sync with the current heuristic output.
- They exist to preserve what broke during development, including one case where `sift` itself was not the ideal debugging surface.
- Where it helps, a sibling `*.current.txt` file shows the current `sift` behavior after the follow-up fixes landed.

## Included incidents

- `01-targeted-heuristics-vitest.raw.txt`
- `02-targeted-initial-sift-misroute.note.md`
- `02-targeted-initial-sift-misroute.current.txt`
- `03-full-suite-provider-followup.sift.standard.txt`
- `03-full-suite-provider-followup.current.txt`
- `04-release-and-exec-vitest.raw.txt`
- `04-release-and-exec-vitest.current.txt`
- `05-exec-smoke-likely-owner-drift.excerpt.txt`
- `05-exec-smoke-likely-owner-drift.current.txt`
- `06-release-workflow-node-version-drift.excerpt.txt`
- `06-release-workflow-node-version-drift.current.txt`

## Notes

- Machine-local absolute paths were sanitized to placeholders like `<repo>`.
- These files are validated for presence and hygiene, but intentionally excluded from the example sync test.
- The `*.current.txt` siblings are informational after-fix captures, not benchmark-backed showcase outputs.
