import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { analyzeTestStatus } from "../src/core/heuristics.js";
import {
  buildGenericRawSlice,
  buildTestStatusRawSlice
} from "../src/core/rawSlice.js";
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
    ...Array.from(
      { length: 124 },
      () =>
        "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users."
    ),
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

function buildObservedAnchorFailureOutput(): string {
  return [
    ...Array.from({ length: 80 }, (_, index) => `noise line ${index + 1}`),
    "_ ERROR collecting tests/contracts/test_db_schema_freeze.py _",
    "tests/conftest.py:374: in _postgres_schema_isolation",
    "    raise RuntimeError(\"DB-isolated tests require PGTEST_POSTGRES_DSN\")",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "============= 1 error in 0.22s ============="
  ].join("\n");
}

function buildGenericRuntimeSwampOutput(): string {
  return [
    ...Array.from({ length: 60 }, (_, index) => `E   RuntimeError: generic runtime noise ${index + 1}`),
    "FAILED tests/unit/test_cache.py::test_cache_payload - RuntimeError: cache payload missing subject",
    "tests/unit/test_cache.py:41: in test_cache_payload",
    "    raise RuntimeError(\"cache payload missing subject\")",
    "E   RuntimeError: cache payload missing subject",
    ...Array.from({ length: 60 }, (_, index) => `log line ${index + 1}`)
  ].join("\n");
}

function buildClusteredFailureHeaderOutput(): string {
  return [
    "platform darwin -- Python 3.11.4",
    ...Array.from({ length: 40 }, (_, index) => `noise block A ${index + 1}`),
    "FAILED tests/unit/test_alpha.py::test_alpha - RuntimeError: alpha exploded",
    "E   RuntimeError: alpha exploded",
    ...Array.from({ length: 80 }, (_, index) => `noise block B ${index + 1}`),
    "ERROR tests/unit/test_beta.py::test_beta - RuntimeError: beta exploded",
    "E   RuntimeError: beta exploded",
    ...Array.from({ length: 80 }, (_, index) => `noise block C ${index + 1}`),
    "FAILED tests/unit/test_gamma.py::test_gamma - RuntimeError: gamma exploded",
    "E   RuntimeError: gamma exploded",
    "============= 2 failed, 1 error in 0.18s ============="
  ].join("\n");
}

describe("raw slice helpers", () => {
  it("keeps short inputs untouched", () => {
    const slice = buildGenericRawSlice({
      input: "short output",
      config: defaultConfig.input
    });

    expect(slice).toEqual({
      text: "short output",
      strategy: "none",
      used: false
    });
  });

  it("prioritizes test-status bucket evidence over plain head-tail truncation", () => {
    const input = buildMixedFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis,
      remainingTests: [
        "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen",
        "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen"
      ]
    });

    const slice = buildTestStatusRawSlice({
      input,
      config: {
        ...defaultConfig.input,
        maxInputChars: 700,
        headChars: 120,
        tailChars: 80
      },
      contract: decision.contract
    });

    expect(slice.used).toBe(true);
    expect(slice.strategy).toBe("bucket_evidence");
    expect(slice.text).toContain("PGTEST_POSTGRES_DSN");
    expect(slice.text).toContain("/api/v1/admin/landing-gallery");
    expect(slice.text).toContain("FAILED");
  });

  it("prefers high-signal bucket terms over generic runtime noise", () => {
    const input = buildGenericRuntimeSwampOutput();
    const contract = {
      main_buckets: [
        {
          bucket_index: 1,
          label: "runtime failure",
          count: 1,
          root_cause: "RuntimeError: cache payload missing subject",
          evidence: [
            "tests/unit/test_cache.py::test_cache_payload -> RuntimeError: cache payload missing subject"
          ]
        }
      ],
      read_targets: []
    } as unknown as Parameters<typeof buildTestStatusRawSlice>[0]["contract"];

    const slice = buildTestStatusRawSlice({
      input,
      config: {
        ...defaultConfig.input,
        maxInputChars: 260,
        headChars: 60,
        tailChars: 60
      },
      contract
    });

    expect(slice.strategy).toBe("bucket_evidence");
    expect(slice.text).toContain("cache payload missing subject");
    expect(slice.text).not.toContain("generic runtime noise 1");
  });

  it("prioritizes observed read-target anchors and narrow traceback windows", () => {
    const input = buildObservedAnchorFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    const slice = buildTestStatusRawSlice({
      input,
      config: {
        ...defaultConfig.input,
        maxInputChars: 260,
        headChars: 60,
        tailChars: 60
      },
      contract: decision.contract
    });

    expect(slice.used).toBe(true);
    expect(slice.strategy).toBe("bucket_evidence");
    expect(slice.text).toContain("tests/conftest.py:374: in _postgres_schema_isolation");
    expect(slice.text).toContain("PGTEST_POSTGRES_DSN");
    expect(slice.text).not.toContain("noise line 1\nnoise line 2\nnoise line 3");
  });

  it("keeps evidence from multiple distant failure regions under a tight budget", () => {
    const input = buildClusteredFailureHeaderOutput();
    const contract = {
      main_buckets: [],
      read_targets: []
    } as unknown as Parameters<typeof buildTestStatusRawSlice>[0]["contract"];

    const slice = buildTestStatusRawSlice({
      input,
      config: {
        ...defaultConfig.input,
        maxInputChars: 320,
        headChars: 60,
        tailChars: 60
      },
      contract
    });

    expect(slice.strategy).toBe("bucket_evidence");
    expect(slice.text).toContain("tests/unit/test_alpha.py::test_alpha");
    expect(slice.text).toContain("tests/unit/test_beta.py::test_beta");
    expect(slice.text).toContain("tests/unit/test_gamma.py::test_gamma");
  });

  it("falls back to traceback windows for generic long output", () => {
    const input = [
      ...Array.from({ length: 120 }, (_, index) => `noise line ${index + 1}`),
      "Traceback (most recent call last):",
      '  File "/repo/app.py", line 14, in <module>',
      '    raise RuntimeError("database refused connection")',
      "RuntimeError: database refused connection",
      "ERROR command failed"
    ].join("\n");

    const slice = buildGenericRawSlice({
      input,
      config: {
        ...defaultConfig.input,
        maxInputChars: 260,
        headChars: 80,
        tailChars: 80
      }
    });

    expect(slice.used).toBe(true);
    expect(slice.strategy).toBe("traceback_window");
    expect(slice.text).toContain("Traceback");
    expect(slice.text).toContain("database refused connection");
    expect(slice.text).not.toContain("noise line 1\nnoise line 2\nnoise line 3");
  });

  it("falls back to head-tail when no useful traceback signal exists", () => {
    const input = Array.from({ length: 200 }, (_, index) => `plain log line ${index + 1}`).join("\n");

    const slice = buildGenericRawSlice({
      input,
      config: {
        ...defaultConfig.input,
        maxInputChars: 240,
        headChars: 80,
        tailChars: 80
      }
    });

    expect(slice.used).toBe(true);
    expect(slice.strategy).toBe("head_tail");
    expect(slice.text).toContain("plain log line 1");
    expect(slice.text).toContain("plain log line 200");
  });
});
