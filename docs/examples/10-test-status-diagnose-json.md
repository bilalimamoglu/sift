# Example: Test Status Diagnose JSON

**Preset:** `test-status`
**Fixture:** `mixed-full-suite-real`
**Source type:** `repo-captured`
**Render mode:** `diagnose-json`

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
tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [  1%]
tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen FAILED [  1%]
tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema ERROR [  2%]
...
```

## After

```json
{
  "status": "ok",
  "diagnosis_complete": true,
  "raw_needed": false,
  "additional_source_read_likely_low_value": true,
  "read_raw_only_if": null,
  "decision": "stop",
  "primary_suspect_kind": "environment",
  "confidence_reason": "Dominant blocker (missing test env) is anchored and actionable.",
  "dominant_blocker_bucket_index": 1,
  "provider_used": false,
  "provider_confidence": null,
  "provider_failed": false,
  "raw_slice_used": false,
  "raw_slice_strategy": "none",
  "main_buckets": [
    {
      "bucket_index": 1,
      "label": "missing test env",
      "count": 124,
      "root_cause": "missing test env: PGTEST_POSTGRES_DSN",
      "suspect_kind": "environment",
      "fix_hint": "Set PGTEST_POSTGRES_DSN (or pass --pgtest-dsn) before rerunning DB-isolated tests.",
      "evidence": [
        "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen -> missing test env: PGTEST_POSTGRES_DSN",
        "tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema -> missing test env: PGTEST_POSTGRES_DSN"
      ],
      "bucket_confidence": 0.95,
      "root_cause_confidence": 0.95,
      "dominant": true,
      "secondary_visible_despite_blocker": false,
      "mini_diff": null
    },
    {
      "bucket_index": 2,
      "label": "route drift",
      "count": 3,
      "root_cause": "freeze snapshots are out of sync with current API/model state",
      "suspect_kind": "test",
      "fix_hint": "If these API/model changes are intentional, regenerate the contract snapshots and rerun the freeze tests.",
      "evidence": [
        "tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen -> removed model: openai-gpt-image-1.5",
        "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen -> added path: /api/v1/admin/landing-gallery"
      ],
      "bucket_confidence": 0.95,
      "root_cause_confidence": 0.92,
      "dominant": false,
      "secondary_visible_despite_blocker": true,
      "mini_diff": {
        "added_paths": 4,
        "removed_models": 2,
        "changed_task_mappings": 14
      }
    }
  ],
  "read_targets": [
    {
      "file": "tests/contracts/test_db_schema_freeze.py",
      "line": null,
      "why": "it contains the PGTEST_POSTGRES_DSN setup guard",
      "bucket_index": 1,
      "context_hint": {
        "start_line": null,
        "end_line": null,
        "search_hint": "PGTEST_POSTGRES_DSN"
      }
    },
    {
      "file": "tests/contracts/test_feature_manifest_freeze.py",
      "line": null,
      "why": "it maps to the visible route drift bucket",
      "bucket_index": 2,
      "context_hint": {
        "start_line": null,
        "end_line": null,
        "search_hint": "/api/v1/admin/landing-gallery"
      }
    }
  ],
  "next_best_action": {
    "code": "fix_dominant_blocker",
    "bucket_index": 1,
    "note": "Fix bucket 1 first, then rerun the full suite at standard. Secondary buckets are already visible behind it."
  },
  "resolved_summary": {
    "count": 0,
    "families": []
  },
  "remaining_summary": {
    "count": 127,
    "families": [
      {
        "prefix": "tests/integration/",
        "count": 90
      },
      {
        "prefix": "tests/e2e/",
        "count": 23
      },
      {
        "prefix": "tests/contracts/",
        "count": 8
      },
      {
        "prefix": "tests/unit/",
        "count": 6
      }
    ]
  },
  "remaining_subset_available": false
}
```

## Impact

- Raw: `816753` chars / `195406` tokens
- Reduced: `3525` chars / `937` tokens
- Reduction: `99.52%`

## Related Files

- Benchmark raw input: [test/fixtures/bench/test-status/real/mixed-full-suite.txt](../../test/fixtures/bench/test-status/real/mixed-full-suite.txt)
- Companion rendered output: [examples/test-status/mixed-full-suite-real.diagnose.json](../../examples/test-status/mixed-full-suite-real.diagnose.json)
