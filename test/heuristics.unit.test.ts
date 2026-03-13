import { describe, expect, it } from "vitest";
import {
  analyzeTestStatus,
  applyHeuristicPolicy
} from "../src/core/heuristics.js";
import {
  buildTestStatusDiagnoseContract,
  buildTestStatusPublicDiagnoseContract
} from "../src/core/testStatusDecision.js";

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

function buildObservedAnchorOutput(): string {
  return [
    "1 error during collection",
    "_ ERROR collecting tests/contracts/test_db_schema_freeze.py _",
    "tests/conftest.py:374: in _postgres_schema_isolation",
    "    raise RuntimeError(\"DB-isolated tests require PGTEST_POSTGRES_DSN\")",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users."
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
    expect(output).toContain(
      "Anchor: search PGTEST_POSTGRES_DSN in tests/contracts/test_db_schema_freeze.py"
    );
    expect(output).toContain(
      "Fix: Set PGTEST_POSTGRES_DSN (or pass --pgtest-dsn) before rerunning DB-isolated tests."
    );
    expect(output).toContain("Contract drift: 3 freeze tests are out of sync");
    expect(output).toContain(
      "Anchor: search /api/v1/admin/landing-gallery in tests/contracts/test_feature_manifest_freeze.py"
    );
    expect(output).toContain(
      "Fix: If these changes are intentional, run python scripts/update_contract_snapshots.py and rerun the freeze tests."
    );
    expect(output).toContain("Next: Fix bucket 1 first, then rerun the full suite at standard.");
    expect(output).toContain(
      "Next: Fix bucket 1 first, then rerun the full suite at standard. Secondary buckets are already visible behind it."
    );
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

  it("classifies service, db, fixture, and auth setup failures into first-class buckets", () => {
    const input = [
      "ERROR tests/api/test_health.py::test_ready - 503 Service Unavailable",
      "ERROR tests/db/test_users.py::test_refresh - ConnectionRefusedError: could not connect to server on port 5432",
      "ERROR tests/auth/test_session.py::test_impersonation - auth bypass missing for integration tests",
      "ERROR tests/fixtures/test_bootstrap.py::test_env - FixtureLookupError: capsys fixture not available",
      "============= 4 errors in 0.40s ============="
    ].join("\n");

    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(decision.contract.main_buckets.map((bucket) => bucket.root_cause)).toEqual(
      expect.arrayContaining([
        "fixture guard: capsys",
        "auth bypass absent: test auth bypass is missing",
        "db refused: database connection was refused"
      ])
    );

    const serviceOnlyInput = [
      "ERROR tests/api/test_health.py::test_ready - 503 Service Unavailable",
      "============= 1 error in 0.10s ============="
    ].join("\n");
    const serviceOnlyDecision = buildTestStatusDiagnoseContract({
      input: serviceOnlyInput,
      analysis: analyzeTestStatus(serviceOnlyInput)
    });
    expect(serviceOnlyDecision.contract.main_buckets[0]?.root_cause).toBe(
      "service unavailable: dependency service is unavailable"
    );
  });

  it("detects generic env blockers beyond repo-specific literals", () => {
    const input = [
      "ERROR tests/cache/test_bootstrap.py::test_cache - KeyError: 'REDIS_URL'",
      "ERROR tests/api/test_auth.py::test_login - ValidationError: MISSING_API_KEY is not set",
      "============= 2 errors in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.contract.main_buckets.map((bucket) => bucket.root_cause)).toEqual(
      expect.arrayContaining(["missing test env: REDIS_URL", "missing test env: MISSING_API_KEY"])
    );
  });

  it("adds conservative unknown buckets when visible counts are not fully explained", () => {
    const input = [
      "src/auth.test.ts > refresh token ERROR [ 20%]",
      "src/routes.test.ts > landing page FAILED [ 40%]",
      "src/tasks.test.ts > task payload FAILED [ 60%]",
      "============= 2 failed, 3 errors in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.contract.diagnosis_complete).toBe(false);
    expect(decision.contract.decision).toBe("zoom");
    expect(decision.contract.main_buckets.map((bucket) => bucket.label)).toEqual(
      expect.arrayContaining(["unknown setup blocker", "unknown failure family"])
    );
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
    expect(decision.contract.read_targets).toMatchObject([
      {
        file: "tests/contracts/test_db_schema_freeze.py",
        line: null,
        bucket_index: 1
      },
      {
        file: "tests/contracts/test_feature_manifest_freeze.py",
        line: null
      }
    ]);
    expect(new Set(decision.contract.read_targets.map((target) => target.bucket_index)).size).toBe(
      decision.contract.read_targets.length
    );
    expect(decision.contract.next_best_action.note).toContain(
      "Fix bucket 1 first, then rerun the full suite at standard."
    );
    expect(decision.contract.read_targets[0]?.context_hint).toEqual({
      start_line: null,
      end_line: null,
      search_hint: "PGTEST_POSTGRES_DSN"
    });
  });

  it("builds a summary-first public diagnose contract and keeps full ids opt-in", () => {
    const input = buildMixedFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis,
      resolvedTests: ["tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen"],
      remainingTests: [
        "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen",
        "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen",
        "worker/test_job.py::test_other_failure",
        "opaque-id"
      ]
    });

    const summaryFirst = buildTestStatusPublicDiagnoseContract({
      contract: decision.contract,
      remainingSubsetAvailable: true
    });
    expect(summaryFirst.resolved_summary).toEqual({
      count: 1,
      families: [{ prefix: "tests/contracts/", count: 1 }]
    });
    expect(summaryFirst.remaining_summary).toEqual({
      count: 4,
      families: [
        { prefix: "tests/contracts/", count: 2 },
        { prefix: "other", count: 1 },
        { prefix: "worker/", count: 1 }
      ]
    });
    expect(summaryFirst.remaining_subset_available).toBe(true);
    expect(summaryFirst).not.toHaveProperty("resolved_tests");
    expect(summaryFirst).not.toHaveProperty("remaining_tests");

    const withIds = buildTestStatusPublicDiagnoseContract({
      contract: decision.contract,
      remainingSubsetAvailable: true,
      includeTestIds: true
    });
    expect(withIds.resolved_tests).toHaveLength(1);
    expect(withIds.remaining_tests).toHaveLength(4);
  });

  it("prefers observed traceback anchors for read targets without inventing line numbers", () => {
    const input = buildObservedAnchorOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(analysis.collectionItems[0]).toMatchObject({
      file: "tests/conftest.py",
      line: 374,
      anchor_kind: "traceback"
    });
    expect(decision.contract.read_targets[0]).toEqual({
      file: "tests/conftest.py",
      line: 374,
      why: "it contains the PGTEST_POSTGRES_DSN setup guard",
      bucket_index: 1,
      context_hint: {
        start_line: 369,
        end_line: 379,
        search_hint: null
      }
    });
    expect(decision.contract.next_best_action.note).toContain(
      "Fix bucket 1 first, then rerun the full suite at standard."
    );
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
