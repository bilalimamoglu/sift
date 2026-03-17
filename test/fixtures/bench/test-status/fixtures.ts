import type { FailureBucketType } from "../../../../src/core/heuristics.js";
import type { DetailLevel } from "../../../../src/types.js";

export interface BenchRecipeStep {
  command: string;
  output: string;
}

export interface BenchCompletionExpectation {
  expectedBuckets: FailureBucketType[];
  expectedEntitiesAny?: string[];
  expectedMaxDetail: DetailLevel;
}

export interface BenchFixture {
  name: string;
  description: string;
  rawOutput: string;
  rawRecipe: BenchRecipeStep[];
  rawRecipeStopAfter: number;
  completion: BenchCompletionExpectation;
}

function buildRepeatedErrors(args: {
  labels: string[];
  reasonLine: string;
  total: number;
}): string {
  const lines: string[] = [];

  for (let index = 0; index < args.total; index += 1) {
    const label = args.labels[index % args.labels.length]!;
    lines.push(`${label} ERROR [ ${(index % 9) + 1}%]`);
  }

  for (let index = 0; index < Math.max(args.total, 4); index += 1) {
    lines.push(args.reasonLine);
  }

  return lines.join("\n");
}

function buildSingleBlockerShortRaw(): string {
  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.4, pytest-9.0.2",
    "collecting ... collected 7 items",
    "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [ 14%]",
    "",
    "==================================== ERRORS ====================================",
    "__________ ERROR at setup of test_database_schema_snapshot_is_frozen ___________",
    "tests/conftest.py:374: in _postgres_schema_isolation",
    "    raise RuntimeError(",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "",
    "=========================== short test summary info ============================",
    "ERROR tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen - RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "========================== 6 passed, 1 error in 1.07s =========================="
  ].join("\n");
}

function buildMixedFullSuiteRaw(): string {
  const repeatedDbErrors = buildRepeatedErrors({
    labels: [
      "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen",
      "tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema",
      "tests/e2e/test_core_functionality.py::test_health_and_provider_capabilities",
      "tests/unit/providers/test_provider_capabilities_and_schema.py::test_scene_reference_schema_auto_migrates"
    ],
    reasonLine:
      "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    total: 124
  });

  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.4, pytest-9.0.2, pluggy-1.6.0",
    "collecting ... collected 640 items",
    "tests/contracts/test_backend_module_manifest_freeze.py::test_backend_module_manifest_is_frozen PASSED [  0%]",
    "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [  1%]",
    "tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen FAILED [  1%]",
    "tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema ERROR [  2%]",
    "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen FAILED [  3%]",
    "tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen FAILED [  4%]",
    "tests/e2e/test_core_functionality.py::test_health_and_provider_capabilities ERROR [  4%]",
    "tests/unit/providers/test_provider_capabilities_and_schema.py::test_scene_reference_schema_auto_migrates ERROR [  5%]",
    "",
    repeatedDbErrors,
    "",
    "python scripts/update_contract_snapshots.py",
    "E     Left contains 4 more items:",
    "E     {'/api/v1/admin/landing-gallery': ['GET'],",
    "E      '/api/v1/admin/landing-gallery/drafts/{draft_id}/discard': ['POST'],",
    "E      '/api/v1/admin/landing-gallery/publish': ['PUT'],",
    "E      '/api/v1/admin/landing-gallery/uploads/stream': ['POST']}",
    "  +     '/api/v1/admin/landing-gallery': [",
    "  +         'GET',",
    "  +     ],",
    "  +     '/api/v1/admin/landing-gallery/drafts/{draft_id}/discard': [",
    "  +         'POST',",
    "  +     ],",
    "  +     '/api/v1/admin/landing-gallery/publish': [",
    "  +         'PUT',",
    "  +     ],",
    "  +     '/api/v1/admin/landing-gallery/uploads/stream': [",
    "  +         'POST',",
    "  +     ],",
    "  -             'openai-gpt-image-1.5',",
    "  -             'openai-gpt-image-1.5',",
    "  -             'openai-gpt-image-1.5',",
    "",
    "=========================== short test summary info ============================",
    "ERROR tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen",
    "ERROR tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema",
    "ERROR tests/e2e/test_core_functionality.py::test_health_and_provider_capabilities",
    "ERROR tests/unit/providers/test_provider_capabilities_and_schema.py::test_scene_reference_schema_auto_migrates",
    "FAILED tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen",
    "FAILED tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen",
    "FAILED tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen",
    "============= 3 failed, 511 passed, 2 skipped, 124 errors in 3.46s ============="
  ].join("\n");
}

function buildSnapshotDriftOnlyRaw(): string {
  return [
    "collecting ... collected 3 items",
    "tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen FAILED [ 33%]",
    "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen FAILED [ 66%]",
    "tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen FAILED [100%]",
    "",
    "python scripts/update_contract_snapshots.py",
    "E     Left contains 4 more items:",
    "E     {'/api/v1/admin/landing-gallery': ['GET'],",
    "E      '/api/v1/admin/landing-gallery/drafts/{draft_id}/discard': ['POST'],",
    "E      '/api/v1/admin/landing-gallery/publish': ['PUT'],",
    "E      '/api/v1/admin/landing-gallery/uploads/stream': ['POST']}",
    "  +     '/api/v1/admin/landing-gallery': [",
    "  +         'GET',",
    "  +     ],",
    "  -             'openai-gpt-image-1.5',",
    "  -             'openai-gpt-image-1.5',",
    "",
    "=========================== short test summary info ============================",
    "FAILED tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen",
    "FAILED tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen",
    "FAILED tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen",
    "============================== 3 failed in 1.02s =============================="
  ].join("\n");
}

function buildMissingModuleCollectionRaw(): string {
  return [
    "============================= test session starts ==============================",
    "collecting ... collected 18 items / 12 errors",
    "________________ ERROR collecting tests/unit/test_auth_refresh.py _________________",
    "ImportError while importing test module '/repo/tests/unit/test_auth_refresh.py'.",
    "Hint: make sure your test modules/packages have valid Python names.",
    "E   ModuleNotFoundError: No module named 'botocore'",
    "______________ ERROR collecting tests/unit/test_cognito.py ______________",
    "ImportError while importing test module '/repo/tests/unit/test_cognito.py'.",
    "E   ModuleNotFoundError: No module named 'pydantic'",
    "_______ ERROR collecting tests/unit/test_dataset_use_case_facade.py _______",
    "ImportError while importing test module '/repo/tests/unit/test_dataset_use_case_facade.py'.",
    "E   ModuleNotFoundError: No module named 'fastapi'",
    "________ ERROR collecting tests/unit/test_image_quality_helpers.py ________",
    "ImportError while importing test module '/repo/tests/unit/test_image_quality_helpers.py'.",
    "E   ModuleNotFoundError: No module named 'PIL'",
    "_________ ERROR collecting tests/unit/test_seed_import.py __________",
    "ImportError while importing test module '/repo/tests/unit/test_seed_import.py'.",
    "E   ModuleNotFoundError: No module named 'httpx'",
    "_____ ERROR collecting tests/unit/test_reference_utils.py ______",
    "ImportError while importing test module '/repo/tests/unit/test_reference_utils.py'.",
    "E   ModuleNotFoundError: No module named 'numpy'",
    "=========================== short test summary info ============================",
    "ERROR tests/unit/test_auth_refresh.py",
    "ERROR tests/unit/test_cognito.py",
    "ERROR tests/unit/test_dataset_use_case_facade.py",
    "ERROR tests/unit/test_image_quality_helpers.py",
    "ERROR tests/unit/test_seed_import.py",
    "ERROR tests/unit/test_reference_utils.py",
    "============================== 12 errors in 0.84s =============================="
  ].join("\n");
}

function buildVitestSnapshotMismatchRaw(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ❯ src/components/button.test.ts > Button > renders primary FAILED [ 50%]",
    "",
    "⎯⎯⎯ Failed Tests 1 ⎯⎯⎯",
    "",
    " FAIL  src/components/button.test.ts > Button > renders primary",
    "Error: Snapshot `Button > renders primary` mismatched",
    "❯ src/components/button.test.ts:42:19",
    "  40|   const rendered = renderPrimaryButton()",
    "  41|",
    "  42|   expect(rendered).toMatchSnapshot()",
    "     |                   ^",
    "  43| })",
    "  44|",
    "Serialized Error: { expected: '<button class=\"primary\">Save</button>', actual: '<button class=\"primary emphasis\">Save</button>' }",
    "",
    " Test Files  1 failed (1)",
    "      Tests  1 failed | 1 passed (2)",
    "  Snapshots  1 failed (1)"
  ].join("\n");
}

function buildVitestMixedJsRaw(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ❯ src/components/button.test.ts > Button > renders primary FAILED [ 25%]",
    " ❯ src/hooks/timeout.test.ts > useSlowHook > resolves FAILED [ 50%]",
    " ❯ src/setup/auth.test.ts ERROR [ 75%]",
    "",
    "⎯⎯⎯ Failed Tests 2 ⎯⎯⎯",
    "",
    " FAIL  src/components/button.test.ts > Button > renders primary",
    "Error: Snapshot `Button > renders primary` mismatched",
    "❯ src/components/button.test.ts:42:19",
    "",
    " FAIL  src/hooks/timeout.test.ts > useSlowHook > resolves",
    "Error: Test timed out in 5000ms.",
    "❯ src/hooks/timeout.test.ts:21:9",
    "",
    "⎯⎯⎯ Failed Suites 1 ⎯⎯⎯",
    "",
    " FAIL  src/setup/auth.test.ts [ src/setup/auth.test.ts ]",
    "Error: Failed to resolve import \"@/missing-client\" from \"src/setup/auth.test.ts\". Does the file exist?",
    "❯ src/setup/auth.test.ts:1:1",
    "",
    " Test Files  2 failed | 1 passed (3)",
    "      Tests  2 failed | 1 passed (3)",
    "  Snapshots  1 failed (1)"
  ].join("\n");
}

function buildJestMixedJsRaw(): string {
  return [
    "FAIL src/components/card.test.ts",
    "  ✕ renders the card",
    "",
    "  ● renders the card",
    "",
    "    Error: Snapshot `renders the card` mismatched",
    "    at Object.<anonymous> (src/components/card.test.ts:12:7)",
    "    Expected: <div class=\"card\">hello</div>",
    "    Received: <div class=\"card elevated\">hello</div>",
    "",
    "      10 |   const card = renderCard()",
    "      11 |",
    "    > 12 |   expect(card).toMatchSnapshot()",
    "         |                ^",
    "      13 | })",
    "",
    "FAIL src/config/setup.test.ts",
    "  ● Test suite failed to run",
    "",
    "    Cannot use import statement outside a module",
    "",
    "    Details:",
    "    /repo/src/config/setup.ts:1",
    "    import { bootstrap } from './bootstrap'",
    "    ^^^^^^",
    "    SyntaxError: Cannot use import statement outside a module",
    "",
    "Test Suites: 2 failed, 1 passed, 3 total",
    "Tests:       1 failed, 2 passed, 3 total"
  ].join("\n");
}

function buildPytestSmallRuntimeSuiteRaw(): string {
  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.4, pytest-9.0.2",
    "collecting ... collected 1 item",
    "tests/unit/test_payloads.py::test_payload_round_trip FAILED [100%]",
    "",
    "=================================== FAILURES ===================================",
    "___________________________ test_payload_round_trip ____________________________",
    "tests/unit/test_payloads.py:48: in test_payload_round_trip",
    "    normalize_payload(payload)",
    "src/app/payloads.py:19: in normalize_payload",
    "    raise RuntimeError(\"payload subject missing\")",
    "E   RuntimeError: payload subject missing",
    "",
    "=========================== short test summary info ============================",
    "FAILED tests/unit/test_payloads.py::test_payload_round_trip - RuntimeError: payload subject missing",
    "============================== 1 failed in 0.09s =============================="
  ].join("\n");
}

function buildVitestExpectAssertionsRaw(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ❯ src/auth/refresh.test.ts > refresh token > rotates token FAILED [ 50%]",
    " ❯ src/routes/landing.test.ts > landing page > renders hero FAILED [100%]",
    "",
    "⎯⎯⎯ Failed Tests 2 ⎯⎯⎯",
    "",
    " FAIL  src/auth/refresh.test.ts > refresh token > rotates token",
    "expect(received).toBe(expected)",
    "Expected: \"next-token\"",
    "Received: \"same-token\"",
    "❯ src/auth/refresh.test.ts:27:15",
    "",
    " FAIL  src/routes/landing.test.ts > landing page > renders hero",
    "expect(received).toEqual(expected)",
    "Expected: {\"cta\":\"Try now\"}",
    "Received: {\"cta\":\"Learn more\"}",
    "❯ src/routes/landing.test.ts:14:7",
    "",
    " Test Files  2 failed (2)",
    "      Tests  2 failed | 1 passed (3)"
  ].join("\n");
}

function buildPytestNetworkResetRaw(): string {
  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.4, pytest-9.0.2",
    "collecting ... collected 3 items",
    "tests/integration/test_stream.py::test_socket_flush ERROR [ 33%]",
    "tests/integration/test_feed.py::test_feed_sync ERROR [ 66%]",
    "tests/integration/test_api.py::test_remote_fallback ERROR [100%]",
    "",
    "==================================== ERRORS ====================================",
    "__________ ERROR at setup of test_socket_flush __________",
    "tests/integration/test_stream.py:18: in test_socket_flush",
    "    client.flush()",
    "src/app/stream_client.py:44: in flush",
    "    raise ConnectionResetError(\"peer reset during flush\")",
    "E   ConnectionResetError: [Errno 54] Connection reset by peer",
    "__________ ERROR at setup of test_feed_sync __________",
    "tests/integration/test_feed.py:31: in test_feed_sync",
    "    writer.write(payload)",
    "src/app/feed_writer.py:52: in write",
    "    raise BrokenPipeError(\"feed pipe closed\")",
    "E   BrokenPipeError: [Errno 32] Broken pipe",
    "__________ ERROR at setup of test_remote_fallback __________",
    "tests/integration/test_api.py:29: in test_remote_fallback",
    "    fetch_remote_feed()",
    "src/app/remote_feed.py:88: in fetch_remote_feed",
    "    response.raise_for_status()",
    "E   HTTPError: 502 Server Error: Bad Gateway for url: https://api.example.com/feed",
    "",
    "=========================== short test summary info ============================",
    "ERROR tests/integration/test_stream.py::test_socket_flush - ConnectionResetError: [Errno 54] Connection reset by peer",
    "ERROR tests/integration/test_feed.py::test_feed_sync - BrokenPipeError: [Errno 32] Broken pipe",
    "ERROR tests/integration/test_api.py::test_remote_fallback - HTTPError: 502 Server Error: Bad Gateway for url: https://api.example.com/feed",
    "============================== 3 errors in 0.14s =============================="
  ].join("\n");
}

function buildPytestOSErrorSetupRaw(): string {
  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.4, pytest-9.0.2",
    "collecting ... collected 2 items",
    "tests/storage/test_tmpdir.py::test_tmpdir_bootstrap ERROR [ 50%]",
    "tests/storage/test_lockfile.py::test_lockfile_cleanup ERROR [100%]",
    "",
    "==================================== ERRORS ====================================",
    "__________ ERROR at setup of test_tmpdir_bootstrap __________",
    "E   OSError: [Errno 28] No space left on device: '/tmp/pytest-scratch'",
    "__________ ERROR at setup of test_lockfile_cleanup __________",
    "E   OSError: [Errno 13] Permission denied: '/tmp/pytest-lock'",
    "",
    "=========================== short test summary info ============================",
    "ERROR tests/storage/test_tmpdir.py::test_tmpdir_bootstrap - OSError: [Errno 28] No space left on device: '/tmp/pytest-scratch'",
    "ERROR tests/storage/test_lockfile.py::test_lockfile_cleanup - OSError: [Errno 13] Permission denied: '/tmp/pytest-lock'",
    "============================== 2 errors in 0.11s =============================="
  ].join("\n");
}

export const benchFixtures: BenchFixture[] = [
  {
    name: "single-blocker-short",
    description: "One DB-backed env blocker on an otherwise short test run.",
    rawOutput: buildSingleBlockerShortRaw(),
    rawRecipe: [
      {
        command: "python -m pytest tests/ -x",
        output: buildSingleBlockerShortRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["shared_environment_blocker"],
      expectedEntitiesAny: ["PGTEST_POSTGRES_DSN"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "mixed-full-suite",
    description: "Shared DB blocker plus contract drift in a larger suite.",
    rawOutput: buildMixedFullSuiteRaw(),
    rawRecipe: [
      {
        command: "python -m pytest tests/",
        output: buildMixedFullSuiteRaw()
      },
      {
        command: "python -m pytest tests/ --tb=no -q",
        output: [
          "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [  1%]",
          "tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen FAILED [  1%]",
          "tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema ERROR [  2%]",
          "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen FAILED [  3%]",
          "tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen FAILED [  4%]",
          "============= 3 failed, 511 passed, 2 skipped, 124 errors in 3.46s ============="
        ].join("\n")
      },
      {
        command: "python -m pytest tests/contracts/test_openapi_contract_freeze.py --tb=long | grep -A10 \"Left contains\"",
        output: [
          "E     Left contains 4 more items:",
          "E     {'/api/v1/admin/landing-gallery': ['GET'],",
          "E      '/api/v1/admin/landing-gallery/drafts/{draft_id}/discard': ['POST'],",
          "E      '/api/v1/admin/landing-gallery/publish': ['PUT'],",
          "E      '/api/v1/admin/landing-gallery/uploads/stream': ['POST']}"
        ].join("\n")
      },
      {
        command: "python -m pytest tests/contracts/test_feature_manifest_freeze.py --tb=short",
        output: [
          "  -             'openai-gpt-image-1.5',",
          "  -             'openai-gpt-image-1.5',",
          "python scripts/update_contract_snapshots.py"
        ].join("\n")
      }
    ],
    rawRecipeStopAfter: 4,
    completion: {
      expectedBuckets: ["shared_environment_blocker", "contract_snapshot_drift"],
      expectedEntitiesAny: [
        "PGTEST_POSTGRES_DSN",
        "openai-gpt-image-1.5",
        "/api/v1/admin/landing-gallery"
      ],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "snapshot-drift-only",
    description: "Only freeze tests are failing because snapshots are stale.",
    rawOutput: buildSnapshotDriftOnlyRaw(),
    rawRecipe: [
      {
        command: "python -m pytest tests/contracts/test_feature_manifest_freeze.py tests/contracts/test_openapi_contract_freeze.py tests/contracts/test_task_matrix_snapshot_freeze.py",
        output: buildSnapshotDriftOnlyRaw()
      },
      {
        command: "python -m pytest tests/contracts/test_openapi_contract_freeze.py --tb=long | grep -A10 \"Left contains\"",
        output: [
          "E     Left contains 4 more items:",
          "E     {'/api/v1/admin/landing-gallery': ['GET'],",
          "E      '/api/v1/admin/landing-gallery/drafts/{draft_id}/discard': ['POST'],",
          "E      '/api/v1/admin/landing-gallery/publish': ['PUT'],",
          "E      '/api/v1/admin/landing-gallery/uploads/stream': ['POST']}"
        ].join("\n")
      }
    ],
    rawRecipeStopAfter: 2,
    completion: {
      expectedBuckets: ["contract_snapshot_drift"],
      expectedEntitiesAny: ["openai-gpt-image-1.5", "/api/v1/admin/landing-gallery"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "missing-module-collection",
    description: "Collection fails because multiple dependencies are missing.",
    rawOutput: buildMissingModuleCollectionRaw(),
    rawRecipe: [
      {
        command: "python -m pytest tests/",
        output: buildMissingModuleCollectionRaw()
      },
      {
        command: "python -m pytest tests/ --tb=short -q | tail -40",
        output: [
          "E   ModuleNotFoundError: No module named 'botocore'",
          "E   ModuleNotFoundError: No module named 'pydantic'",
          "E   ModuleNotFoundError: No module named 'fastapi'",
          "E   ModuleNotFoundError: No module named 'PIL'",
          "E   ModuleNotFoundError: No module named 'httpx'",
          "E   ModuleNotFoundError: No module named 'numpy'"
        ].join("\n")
      }
    ],
    rawRecipeStopAfter: 2,
    completion: {
      expectedBuckets: ["import_dependency_failure"],
      expectedEntitiesAny: ["botocore", "pydantic", "fastapi", "PIL", "httpx", "numpy"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "vitest-snapshot-mismatch",
    description: "Vitest reports a single snapshot mismatch with a traceback anchor.",
    rawOutput: buildVitestSnapshotMismatchRaw(),
    rawRecipe: [
      {
        command: "npx vitest run src/components/button.test.ts",
        output: buildVitestSnapshotMismatchRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["snapshot_mismatch"],
      expectedEntitiesAny: ["Button > renders primary"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "vitest-mixed-js",
    description: "Vitest shows a snapshot mismatch, timeout, and missing import in one run.",
    rawOutput: buildVitestMixedJsRaw(),
    rawRecipe: [
      {
        command: "npx vitest run src/components/button.test.ts src/hooks/timeout.test.ts src/setup/auth.test.ts",
        output: buildVitestMixedJsRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["import_dependency_failure", "snapshot_mismatch", "timeout_failure"],
      expectedEntitiesAny: ["@/missing-client", "Button > renders primary"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "jest-mixed-js",
    description: "Jest reports a config error and a snapshot mismatch in the same run.",
    rawOutput: buildJestMixedJsRaw(),
    rawRecipe: [
      {
        command: "npx jest src/components/card.test.ts src/config/setup.test.ts",
        output: buildJestMixedJsRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["configuration_error", "snapshot_mismatch"],
      expectedEntitiesAny: ["src/components/card.test.ts"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "pytest-small-runtime-suite",
    description: "A single concrete runtime failure should be self-sufficient at standard detail.",
    rawOutput: buildPytestSmallRuntimeSuiteRaw(),
    rawRecipe: [
      {
        command: "python -m pytest tests/unit/test_payloads.py",
        output: buildPytestSmallRuntimeSuiteRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["runtime_failure"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "vitest-expect-assertions",
    description: "Vitest matcher failures should classify into assertion buckets without raw fallback.",
    rawOutput: buildVitestExpectAssertionsRaw(),
    rawRecipe: [
      {
        command: "npx vitest run src/auth/refresh.test.ts src/routes/landing.test.ts",
        output: buildVitestExpectAssertionsRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["assertion_failure"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "pytest-network-reset",
    description: "Network reset and gateway timeout errors should collapse into a network bucket.",
    rawOutput: buildPytestNetworkResetRaw(),
    rawRecipe: [
      {
        command: "python -m pytest tests/integration/test_stream.py tests/integration/test_feed.py tests/integration/test_api.py",
        output: buildPytestNetworkResetRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["network_failure"],
      expectedMaxDetail: "standard"
    }
  },
  {
    name: "pytest-oserror-setup",
    description: "Setup OSErrors should map to configuration and permission buckets.",
    rawOutput: buildPytestOSErrorSetupRaw(),
    rawRecipe: [
      {
        command: "python -m pytest tests/storage/test_tmpdir.py tests/storage/test_lockfile.py",
        output: buildPytestOSErrorSetupRaw()
      }
    ],
    rawRecipeStopAfter: 1,
    completion: {
      expectedBuckets: ["configuration_error", "permission_denied_failure"],
      expectedMaxDetail: "standard"
    }
  }
];
