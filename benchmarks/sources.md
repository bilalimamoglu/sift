# Benchmark Sources

These benchmark cases are the source of truth for `raw -> reduced` shrinkage across deterministic presets that currently bypass the provider.

## Provenance

| id | preset | source_type | expected_reduction_kind | notes |
|---|---|---|---|---|
| `ts-wall-mixed` | `typecheck-summary` | `synthetic-derived` | `grouped-errors` | Mixed TS codes arranged so the top grouped errors are deterministic. |
| `ts-module-not-found` | `typecheck-summary` | `synthetic-derived` | `grouped-errors` | Concentrated TS2307 missing-module case. |
| `ts-single-file-errors` | `typecheck-summary` | `synthetic-derived` | `grouped-errors` | Narrow single-file wall for focused grouping. |
| `eslint-mixed-rules` | `lint-failures` | `synthetic-derived` | `rule-summary` | Stylish output with mixed errors, warnings, and fixable hints. |
| `eslint-single-file-dense` | `lint-failures` | `synthetic-derived` | `rule-summary` | Dense single-file report to stress stable rule ordering. |
| `eslint-warnings-only` | `lint-failures` | `synthetic-derived` | `rule-summary` | Zero-error warnings-only edge case. |
| `esbuild-missing-module` | `build-failure` | `synthetic-derived` | `brief-root-cause` | esbuild `[ERROR]` module-resolution sample with a file/line anchor. |
| `webpack-type-error` | `build-failure` | `synthetic-derived` | `brief-root-cause` | webpack `ERROR in` sample where the first concrete line is a type error. |
| `vite-syntax-error` | `build-failure` | `synthetic-derived` | `brief-root-cause` | Vite/esbuild syntax error sample with stable location formatting. |
| `npm-audit-critical-only` | `audit-critical` | `synthetic-derived` | `security-findings` | Default npm audit report blocks with `Severity:` lines; only critical findings survive reduction. |
| `npm-audit-mixed-severity` | `audit-critical` | `synthetic-derived` | `security-findings` | Default npm audit report blocks where only high and critical findings survive reduction. |
| `npm-audit-clean` | `audit-critical` | `synthetic-derived` | `security-findings` | Explicit zero-vulnerability audit output used to prove the clean-pass heuristic path. |
| `tf-plan-destroy` | `infra-risk` | `synthetic-derived` | `risk-verdict` | Terraform plan with destructive evidence and a non-zero destroy summary. |
| `tf-plan-safe-additions` | `infra-risk` | `synthetic-derived` | `risk-verdict` | Terraform plan with explicit zero destructive actions and a pass verdict. |
| `tf-plan-mixed-risk` | `infra-risk` | `synthetic-derived` | `risk-verdict` | Terraform plan with mixed change types where one destroy line still forces a fail verdict. |

## Capture Rules

- Strip secrets, access tokens, usernames, and hostnames before freezing any sample.
- Keep the parser-compatible shape intact even when shortening the sample.
- Prefer representative slices over full logs when the full output adds no new signal.
- Use `synthetic-derived` unless a truly stable captured output is already available.
- Name files by truth: these are raw inputs, so they live under `benchmarks/cases/` with `.raw.txt` suffixes.
- Keep one intentionally large wall case per grouped preset family so token-reduction benchmarks still reflect realistic noisy CI output without making every sample huge.

## Future Sourcing Queries

### `typecheck-summary`

- `site:github.com "error TS2322" "Found" "errors in"`
- `site:github.com/actions "tsc --noEmit" "TS2307"`
- `site:stackoverflow.com "TS2741" "TS2339"`

### `lint-failures`

- `site:github.com "✖" "problems (" "eslint"`
- `site:github.com/actions "no-unused-vars" "react/react-in-jsx-scope"`
- `site:eslint.org stylish formatter`

### `build-failure`

- `site:github.com "\"[ERROR] Could not resolve\"" esbuild`
- `site:github.com "\"ERROR in ./src\"" webpack`
- `site:github.com "\"Expected \\\";\\\" but found \\\"{\\\"\"" vite`

### `audit-critical`

- `site:github.com "\"npm audit report\"" "\"critical\"" "\"high\""`
- `site:github.com/actions "\"npm audit\"" "\"vulnerabilities\""`
- `site:github.com "\"GHSA-\"" "\"npm audit\""`

### `infra-risk`

- `site:github.com "\"Terraform will perform the following actions\"" "\"to destroy\""`
- `site:github.com "\"Plan: 0 to change, 0 to destroy\"" terraform`
- `site:github.com "\"will be destroyed\"" "\"terraform plan\""`

## Target Counts

- Docs gallery: 1-2 strong examples per preset
- Benchmark corpus: 3-6 stable cases per preset in early phases
- Only add a new case when it improves parser coverage or gives a materially different before/after story
