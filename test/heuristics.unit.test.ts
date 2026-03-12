import { describe, expect, it } from "vitest";
import {
  analyzeTestStatus,
  applyHeuristicPolicy
} from "../src/core/heuristics.js";
import { buildTestStatusDiagnoseContract } from "../src/core/testStatusDecision.js";

function buildMixedFailureOutput(): string {
  return [
    "platform darwin -- Python 3.11.4",
    "collecting ... collected 640 items",
    "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [  1%]",
    "tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen FAILED [  1%]",
    "tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema ERROR [  2%]",
    "tests/e2e/test_core_functionality.py::test_health_and_provider_capabilities ERROR [  4%]",
    "tests/unit/providers/test_provider_capabilities_and_schema.py::test_scene_reference_schema_auto_migrates ERROR [  5%]",
    "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen FAILED [  6%]",
    "tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen FAILED [  7%]",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "python scripts/update_contract_snapshots.py",
    "E     Left contains 4 more items:",
    "E     {'/api/v1/admin/landing-gallery': ['GET'],",
    "E      '/api/v1/admin/landing-gallery/drafts/{draft_id}/discard': ['POST'],",
    "E      '/api/v1/admin/landing-gallery/publish': ['PUT'],",
    "E      '/api/v1/admin/landing-gallery/uploads/stream': ['POST']}",
    "  -             'openai-gpt-image-1.5',",
    "============= 3 failed, 511 passed, 2 skipped, 124 errors in 3.46s ============="
  ].join("\n");
}

function buildCollectionImportOutput(): string {
  return [
    "114 errors during collection",
    "_ ERROR collecting tests/unit/test_auth.py _",
    "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
    "E   ModuleNotFoundError: No module named 'pydantic'",
    "_ ERROR collecting tests/unit/test_api.py _",
    "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
    "E   ModuleNotFoundError: No module named 'fastapi'",
    "_ ERROR collecting tests/unit/test_jobs.py _",
    "ImportError while importing test module '/tmp/tests/unit/test_jobs.py'.",
    "E   ModuleNotFoundError: No module named 'botocore'"
  ].join("\n");
}

describe("heuristic policies", () => {
  it("returns null when no policy is active", () => {
    expect(applyHeuristicPolicy(undefined, "anything")).toBeNull();
  });

  it("keeps simple success and no-test summaries short", () => {
    expect(applyHeuristicPolicy("test-status", "12 passed, 0 failed, 2 skipped")).toBe(
      "- Tests passed.\n- 12 tests, 2 skips."
    );

    expect(
      applyHeuristicPolicy(
        "test-status",
        "collected 0 items\n\n============================ no tests ran in 0.01s ============================"
      )
    ).toBe("- Tests did not run.\n- Collected 0 items.");
  });

  it("renders a decision-complete standard summary for mixed blockers and drift", () => {
    const output = applyHeuristicPolicy("test-status", buildMixedFailureOutput());

    expect(output).toContain("- Tests did not pass.");
    expect(output).toContain("- 3 tests failed. 124 errors occurred.");
    expect(output).toContain("Shared blocker: 124 errors require PGTEST_POSTGRES_DSN");
    expect(output).toContain("Contract drift: 3 freeze tests are out of sync");
    expect(output).toContain("Next: Fix bucket 1 first, then rerun the full suite at standard.");
    expect(output).toContain("Stop signal: diagnosis complete; raw not needed.");
  });

  it("keeps focused and verbose output monotonic while adding evidence depth", () => {
    const focused = applyHeuristicPolicy("test-status", buildMixedFailureOutput(), "focused");
    const verbose = applyHeuristicPolicy("test-status", buildMixedFailureOutput(), "verbose");

    expect(focused).not.toBeNull();
    expect(verbose).not.toBeNull();

    if (focused === null || verbose === null) {
      throw new Error("Expected focused and verbose summaries");
    }

    expect(focused).toContain("Shared blocker: 124 errors require PGTEST_POSTGRES_DSN");
    expect(focused).toContain(
      "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen -> missing test env: PGTEST_POSTGRES_DSN"
    );
    expect(focused.indexOf("Shared blocker:")).toBeLessThan(
      focused.indexOf("Contract drift:")
    );

    expect(verbose).toContain("Shared blocker: 124 errors require PGTEST_POSTGRES_DSN");
    expect(verbose).toContain(
      "tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen -> removed model: openai-gpt-image-1.5"
    );
    expect(verbose).toContain('mini-diff: {"removed_models":1}');
    expect(verbose.indexOf("Shared blocker:")).toBeLessThan(
      verbose.indexOf("Contract drift:")
    );
  });

  it("keeps collection-time import blockers grouped and actionable", () => {
    const output = applyHeuristicPolicy("test-status", buildCollectionImportOutput(), "focused");

    expect(output).toContain("- Tests did not complete.");
    expect(output).toContain("- 114 errors occurred during collection.");
    expect(output).toContain(
      "Import/dependency blocker: 114 errors are caused by missing dependencies during test collection."
    );
    expect(output).toContain("Missing modules include pydantic, fastapi, botocore.");
    expect(output).toContain("tests/unit/test_auth.py -> missing module: pydantic");
  });

  it("classifies service, db, fixture, and auth setup failures into visible buckets", () => {
    const input = [
      "ERROR tests/api/test_health.py::test_ready - 503 Service Unavailable",
      "ERROR tests/db/test_users.py::test_refresh - ConnectionRefusedError: could not connect to server on port 5432",
      "ERROR tests/auth/test_session.py::test_impersonation - auth bypass missing for integration tests",
      "ERROR tests/fixtures/test_bootstrap.py::test_env - FixtureLookupError: capsys fixture not available",
      "============= 4 errors in 0.40s ============="
    ].join("\n");

    const output = applyHeuristicPolicy("test-status", input, "focused");

    expect(output).toContain("service unavailable");
    expect(output).toContain("db refused");
    expect(output).toContain("auth bypass absent");
  });

  it("builds a structured diagnose contract with dominant blocker and remaining tests", () => {
    const input = buildMixedFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis,
      resolvedTests: ["tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen"],
      remainingTests: [
        "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen",
        "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen"
      ]
    });

    expect(decision.contract.diagnosis_complete).toBe(true);
    expect(decision.contract.raw_needed).toBe(false);
    expect(decision.contract.dominant_blocker_bucket_index).toBe(1);
    expect(decision.contract.resolved_tests).toHaveLength(1);
    expect(decision.contract.remaining_tests).toHaveLength(2);
    expect(decision.contract.main_buckets[0]).toMatchObject({
      bucket_index: 1,
      label: "missing test env",
      dominant: true
    });
    expect(decision.contract.main_buckets[1]?.mini_diff).toEqual({
      removed_models: 1
    });
    expect(decision.contract.next_best_action.code).toBe("fix_dominant_blocker");
  });

  it("keeps audit-critical and infra-risk heuristics intact", () => {
    expect(
      applyHeuristicPolicy(
        "audit-critical",
        ["lodash: critical vulnerability", "axios: high severity advisory"].join("\n")
      )
    ).toContain('"status": "ok"');

    expect(applyHeuristicPolicy("infra-risk", "Plan: 1 to add, 2 to destroy")).toContain(
      '"verdict": "fail"'
    );
    expect(applyHeuristicPolicy("infra-risk", "Plan: 1 to add, 0 to destroy")).toContain(
      '"verdict": "pass"'
    );
    expect(applyHeuristicPolicy("infra-risk", "safe to apply")).toContain('"verdict": "pass"');
    expect(applyHeuristicPolicy("infra-risk", "unrelated noise")).toBeNull();
  });
});
