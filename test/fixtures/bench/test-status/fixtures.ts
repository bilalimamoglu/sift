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
  }
];
