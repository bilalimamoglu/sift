# Example: Pytest Mixed Suite

**Preset:** `test-status`
**Fixture:** `mixed-full-suite-real`
**Source type:** `repo-captured`

## Before

```text
============================= test session starts ==============================
platform darwin -- Python 3.11.4, pytest-9.0.2, pluggy-1.6.0 -- /usr/local/bin/python
cachedir: .pytest_cache
rootdir: /home/ci/project
configfile: pytest.ini
plugins: anyio-4.12.1, cov-6.2.1, asyncio-1.3.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collecting ... collected 640 items

tests/contracts/test_backend_module_manifest_freeze.py::test_backend_module_manifest_is_frozen PASSED [  0%]
tests/contracts/test_ci_non_regression_mandatory.py::test_backend_quality_gate_includes_required_non_regression_pack PASSED [  0%]
tests/contracts/test_ci_non_regression_mandatory.py::test_release_gate_runs_full_backend_quality_gate_without_fast_mode PASSED [  0%]
tests/contracts/test_ci_non_regression_mandatory.py::test_ci_workflow_executes_release_gate_on_pr_and_main PASSED [  0%]
tests/contracts/test_ci_non_regression_mandatory.py::test_non_regression_workflow_uses_dedicated_test_cognito_secrets_for_smoke PASSED [  0%]
tests/contracts/test_ci_non_regression_mandatory.py::test_compose_test_workflow_enforces_test_isolation_gates_and_marker_segmentation PASSED [  0%]
tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [  1%]
tests/contracts/test_docs_contract_sync.py::test_docs_contract_sync_metadata_is_valid_and_current PASSED [  1%]
tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen FAILED [  1%]
tests/contracts/test_feature_matrix_no_regression.py::test_task_definitions_are_unique_and_step_ranges_are_consistent PASSED [  1%]
tests/contracts/test_feature_matrix_no_regression.py::test_model_specs_have_consistent_task_config_maps PASSED [  1%]
tests/contracts/test_feature_matrix_no_regression.py::test_required_runtime_tasks_have_non_mock_coverage PASSED [  1%]
...
```

## After

```text
- Tests did not pass.
- 3 tests failed. 124 errors occurred.
- Shared blocker: 124 errors require PGTEST_POSTGRES_DSN for DB-isolated tests.
- Anchor: search PGTEST_POSTGRES_DSN in tests/contracts/test_db_schema_freeze.py
- Fix: Set PGTEST_POSTGRES_DSN (or pass --pgtest-dsn) before rerunning DB-isolated tests.
- Contract drift: 3 freeze tests are out of sync with current API/model state.
- Anchor: search /api/v1/admin/landing-gallery in tests/contracts/test_feature_manifest_freeze.py
- Fix: If these API/model changes are intentional, regenerate the contract snapshots and rerun the freeze tests.
- Decision: stop and act. Do not escalate unless you need exact traceback lines.
- Likely owner: environment setup
- Next: Fix bucket 1 first, then rerun the full suite at standard. Secondary buckets are already visible behind it.
- Stop signal: diagnosis complete; raw not needed.
```

## Impact

- Raw: `816753` chars / `195406` tokens
- Reduced: `883` chars / `208` tokens
- Reduction: `99.89%`

## Related Files

- Benchmark raw input: [test/fixtures/bench/test-status/real/mixed-full-suite.txt](../../test/fixtures/bench/test-status/real/mixed-full-suite.txt)
- Companion rendered output: [examples/test-status/mixed-full-suite-real.standard.txt](../../examples/test-status/mixed-full-suite-real.standard.txt)
