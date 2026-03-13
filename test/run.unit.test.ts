import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import type { RunRequest } from "../src/types.js";

const createProviderMock = vi.fn();
const buildPromptMock = vi.fn();
const buildFallbackOutputMock = vi.fn();
const applyHeuristicPolicyMock = vi.fn();
const prepareInputMock = vi.fn();
const isRetriableReasonMock = vi.fn();
const looksLikeRejectedModelOutputMock = vi.fn();

vi.mock("../src/providers/factory.js", () => ({
  createProvider: createProviderMock
}));
vi.mock("../src/prompts/buildPrompt.js", () => ({
  buildPrompt: buildPromptMock
}));
vi.mock("../src/core/fallback.js", () => ({
  buildFallbackOutput: buildFallbackOutputMock
}));
vi.mock("../src/core/heuristics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/heuristics.js")>();
  return {
    ...actual,
    applyHeuristicPolicy: applyHeuristicPolicyMock
  };
});
vi.mock("../src/core/pipeline.js", () => ({
  prepareInput: prepareInputMock
}));
vi.mock("../src/core/quality.js", () => ({
  isRetriableReason: isRetriableReasonMock,
  looksLikeRejectedModelOutput: looksLikeRejectedModelOutputMock
}));

function makeRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    question: "did tests pass?",
    format: "brief",
    stdin: "raw",
    config: defaultConfig,
    ...overrides
  };
}

describe("runSift unit", () => {
  beforeEach(() => {
    createProviderMock.mockReset();
    buildPromptMock.mockReset();
    buildFallbackOutputMock.mockReset();
    applyHeuristicPolicyMock.mockReset();
    prepareInputMock.mockReset();
    isRetriableReasonMock.mockReset();
    looksLikeRejectedModelOutputMock.mockReset();

    prepareInputMock.mockReturnValue({
      raw: "raw",
      sanitized: "raw",
      redacted: "raw",
      truncated: "trimmed",
      meta: {
        originalLength: 3,
        finalLength: 7,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    buildPromptMock.mockReturnValue({
      prompt: "PROMPT",
      responseMode: "text"
    });
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockResolvedValue({ text: "All clear" })
    });
    buildFallbackOutputMock.mockReturnValue("fallback");
    applyHeuristicPolicyMock.mockReturnValue(null);
    isRetriableReasonMock.mockReturnValue(false);
    looksLikeRejectedModelOutputMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns heuristic dry-run payloads", async () => {
    prepareInputMock.mockReturnValue({
      raw: "12 passed",
      sanitized: "12 passed",
      redacted: "12 passed",
      truncated: "12 passed",
      meta: {
        originalLength: 9,
        finalLength: 9,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    const { runSift } = await import("../src/core/run.js");

    const output = await runSift(makeRequest({ dryRun: true, policyName: "test-status" }));
    const parsed = JSON.parse(output);

    expect(parsed.status).toBe("dry-run");
    expect(parsed.strategy).toBe("heuristic");
    expect(parsed.heuristicOutput).toContain("Tests passed.");
    expect(parsed.heuristicInput).toEqual({
      length: 9,
      truncatedApplied: false,
      strategy: "full-redacted"
    });
  });

  it("logs heuristic usage in verbose mode", async () => {
    prepareInputMock.mockReturnValue({
      raw: "12 passed",
      sanitized: "12 passed",
      redacted: "12 passed",
      truncated: "12 passed",
      meta: {
        originalLength: 9,
        finalLength: 9,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { runSift } = await import("../src/core/run.js");

    await expect(
      runSift(
        makeRequest({
          policyName: "test-status",
          config: {
            ...defaultConfig,
            runtime: {
              ...defaultConfig.runtime,
              verbose: true
            }
          }
        })
      )
    ).resolves.toContain("Tests passed.");

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("heuristic=test-status"));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("diagnosis_complete_at_layer=heuristic")
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("heuristic_short_circuit=true")
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("heuristic_input_chars=9"));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("heuristic_input_truncated=false")
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("remaining_ids_exposed=false"));
  });

  it("uses full redacted input for test-status heuristics even when provider-prepared input misses the blocker tail", async () => {
    const mixedFixture = readFileSync(
      new URL("./fixtures/bench/test-status/real/mixed-full-suite.txt", import.meta.url),
      "utf8"
    );

    expect(mixedFixture.includes("PGTEST_POSTGRES_DSN")).toBe(true);
    expect(mixedFixture.slice(0, 54272).includes("PGTEST_POSTGRES_DSN")).toBe(false);

    prepareInputMock.mockReturnValue({
      raw: mixedFixture,
      sanitized: mixedFixture,
      redacted: mixedFixture,
      truncated: mixedFixture.slice(0, 54272),
      meta: {
        originalLength: mixedFixture.length,
        finalLength: 54272,
        redactionApplied: false,
        truncatedApplied: true
      }
    });

    const provider = {
      name: "openai",
      generate: vi.fn()
    };
    createProviderMock.mockReturnValue(provider);
    const { runSift } = await import("../src/core/run.js");

    const output = await runSift(
      makeRequest({
        policyName: "test-status",
        presetName: "test-status"
      })
    );

    expect(output).toContain("Shared blocker: 124 errors require PGTEST_POSTGRES_DSN");
    expect(output).toContain("Contract drift: 3 freeze tests are out of sync");
    expect(output).toContain("Decision: stop and act");
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("uses full redacted input for tail-only audit-critical heuristic findings", async () => {
    const actualHeuristics = await vi.importActual<typeof import("../src/core/heuristics.js")>(
      "../src/core/heuristics.js"
    );
    applyHeuristicPolicyMock.mockImplementation(actualHeuristics.applyHeuristicPolicy);

    const fullInput = [
      "npm audit report",
      ...Array.from({ length: 400 }, () => "informational line without findings"),
      "lodash: critical vulnerability"
    ].join("\n");

    prepareInputMock.mockReturnValue({
      raw: fullInput,
      sanitized: fullInput,
      redacted: fullInput,
      truncated: "npm audit report\ninformational line without findings\n",
      meta: {
        originalLength: fullInput.length,
        finalLength: 52,
        redactionApplied: false,
        truncatedApplied: true
      }
    });

    const { runSift } = await import("../src/core/run.js");
    const output = await runSift(
      makeRequest({
        format: "json",
        policyName: "audit-critical",
        outputContract: defaultConfig.presets["audit-critical"]!.outputContract
      })
    );

    expect(JSON.parse(output)).toEqual({
      status: "ok",
      vulnerabilities: [
        {
          package: "lodash",
          severity: "critical",
          remediation: "Upgrade lodash to a patched version."
        }
      ],
      summary: "One critical vulnerability found in lodash."
    });
  });

  it("uses full redacted input for tail-only infra-risk heuristic findings", async () => {
    const actualHeuristics = await vi.importActual<typeof import("../src/core/heuristics.js")>(
      "../src/core/heuristics.js"
    );
    applyHeuristicPolicyMock.mockImplementation(actualHeuristics.applyHeuristicPolicy);

    const fullInput = [
      "Terraform plan start",
      ...Array.from({ length: 400 }, () => "safe-looking planning noise"),
      "Plan: 2 to add, 1 to destroy"
    ].join("\n");

    prepareInputMock.mockReturnValue({
      raw: fullInput,
      sanitized: fullInput,
      redacted: fullInput,
      truncated: "Terraform plan start\nsafe-looking planning noise\n",
      meta: {
        originalLength: fullInput.length,
        finalLength: 47,
        redactionApplied: false,
        truncatedApplied: true
      }
    });

    const { runSift } = await import("../src/core/run.js");
    const output = await runSift(
      makeRequest({
        format: "verdict",
        policyName: "infra-risk"
      })
    );

    expect(JSON.parse(output)).toEqual({
      verdict: "fail",
      reason: "Destructive or clearly risky infrastructure change signals are present.",
      evidence: ["Plan: 2 to add, 1 to destroy"]
    });
  });

  it("returns summary-first diagnose JSON by default and full ids only when requested", async () => {
    const mixedOutput = [
      "collecting ... collected 10 items",
      "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [ 10%]",
      "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen FAILED [ 20%]",
      "tests/unit/test_auth.py::test_refresh FAILED [ 30%]",
      "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn).",
      "============= 2 failed, 1 error in 0.20s ============="
    ].join("\n");

    prepareInputMock.mockReturnValue({
      raw: mixedOutput,
      sanitized: mixedOutput,
      redacted: mixedOutput,
      truncated: mixedOutput,
      meta: {
        originalLength: mixedOutput.length,
        finalLength: mixedOutput.length,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    const { runSift } = await import("../src/core/run.js");

    const summaryOutput = await runSift(
      makeRequest({
        policyName: "test-status",
        presetName: "test-status",
        goal: "diagnose",
        format: "json",
        testStatusContext: {
          remainingSubsetAvailable: true
        }
      })
    );
    const summaryParsed = JSON.parse(summaryOutput) as {
      remaining_summary: { count: number; families: Array<{ prefix: string; count: number }> };
      resolved_summary: { count: number };
      remaining_subset_available: boolean;
      remaining_tests?: string[];
      resolved_tests?: string[];
    };

    expect(summaryParsed.remaining_summary.count).toBe(3);
    expect(summaryParsed.remaining_summary.families[0]).toEqual({
      prefix: "tests/contracts/",
      count: 2
    });
    expect(summaryParsed.remaining_subset_available).toBe(true);
    expect(summaryParsed.resolved_summary.count).toBe(0);
    expect(summaryParsed.remaining_tests).toBeUndefined();
    expect(summaryParsed.resolved_tests).toBeUndefined();

    const withIdsOutput = await runSift(
      makeRequest({
        policyName: "test-status",
        presetName: "test-status",
        goal: "diagnose",
        format: "json",
        includeTestIds: true,
        testStatusContext: {
          remainingSubsetAvailable: true
        }
      })
    );
    const withIdsParsed = JSON.parse(withIdsOutput) as {
      remaining_tests?: string[];
      resolved_tests?: string[];
    };

    expect(withIdsParsed.remaining_tests).toHaveLength(3);
    expect(withIdsParsed.resolved_tests).toEqual([]);
  });

  it("returns provider dry-run payloads without calling generate", async () => {
    const provider = {
      name: "openai",
      generate: vi.fn()
    };
    createProviderMock.mockReturnValue(provider);
    const { runSift } = await import("../src/core/run.js");

    const output = await runSift(makeRequest({ dryRun: true }));
    const parsed = JSON.parse(output);

    expect(parsed.strategy).toBe("provider");
    expect(parsed.heuristicInput).toEqual({
      length: 3,
      truncatedApplied: false,
      strategy: "full-redacted"
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("normalizes JSON provider output", async () => {
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockResolvedValue({ text: '{"ok":true}' })
    });
    buildPromptMock.mockReturnValue({
      prompt: "PROMPT",
      responseMode: "json"
    });
    const { runSift } = await import("../src/core/run.js");

    await expect(runSift(makeRequest({ format: "json" }))).resolves.toBe(
      JSON.stringify({ ok: true }, null, 2)
    );
  });

  it("falls back on invalid JSON provider output", async () => {
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockResolvedValue({ text: "{bad json" })
    });
    buildPromptMock.mockReturnValue({
      prompt: "PROMPT",
      responseMode: "json"
    });
    const { runSift } = await import("../src/core/run.js");

    await expect(runSift(makeRequest({ format: "json" }))).resolves.toBe("fallback");
    expect(buildFallbackOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Provider returned invalid JSON"
      })
    );
  });

  it("falls back on quality-gate rejection", async () => {
    looksLikeRejectedModelOutputMock.mockReturnValue(true);
    const { runSift } = await import("../src/core/run.js");

    await expect(runSift(makeRequest())).resolves.toBe("fallback");
    expect(buildFallbackOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Model output rejected by quality gate"
      })
    );
  });

  it("retries once for retriable errors and succeeds", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 429"))
      .mockResolvedValueOnce({ text: "Recovered" });
    createProviderMock.mockReturnValue({
      name: "openai",
      generate
    });
    isRetriableReasonMock.mockReturnValue(true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { runSift } = await import("../src/core/run.js");

    await expect(
      runSift(
        makeRequest({
          config: {
            ...defaultConfig,
            runtime: {
              ...defaultConfig.runtime,
              verbose: true
            }
          }
        })
      )
    ).resolves.toBe("Recovered");

    expect(generate).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("falls back after retry exhaustion and non-error throws", async () => {
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockRejectedValue({ boom: true })
    });
    isRetriableReasonMock.mockReturnValue(false);
    const { runSift } = await import("../src/core/run.js");

    await expect(runSift(makeRequest())).resolves.toBe("fallback");
    expect(buildFallbackOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "unknown_error"
      })
    );
  });

  it("falls back after a second retriable error", async () => {
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockRejectedValue(new Error("HTTP 503"))
    });
    isRetriableReasonMock.mockReturnValue(true);
    const { runSift } = await import("../src/core/run.js");

    await expect(runSift(makeRequest())).resolves.toBe("fallback");
    expect(buildFallbackOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "HTTP 503"
      })
    );
  });

  it("adds an empty-output hint to insufficient text responses", async () => {
    prepareInputMock.mockReturnValue({
      raw: "",
      sanitized: "",
      redacted: "",
      truncated: "",
      meta: {
        originalLength: 0,
        finalLength: 0,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi
        .fn()
        .mockResolvedValue({ text: "Insufficient signal in the provided input." })
    });
    const { runSift } = await import("../src/core/run.js");

    await expect(runSift(makeRequest())).resolves.toBe(
      [
        "Insufficient signal in the provided input.",
        "Hint: no command output was captured."
      ].join("\n")
    );
  });

  it("adds a truncation hint to insufficient text responses", async () => {
    prepareInputMock.mockReturnValue({
      raw: "very long raw",
      sanitized: "very long raw",
      redacted: "very long raw",
      truncated: "trimmed",
      meta: {
        originalLength: 200,
        finalLength: 12,
        redactionApplied: false,
        truncatedApplied: true
      }
    });
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi
        .fn()
        .mockResolvedValue({ text: "Insufficient signal in the provided input." })
    });
    const { runSift } = await import("../src/core/run.js");

    await expect(runSift(makeRequest())).resolves.toBe(
      [
        "Insufficient signal in the provided input.",
        "Hint: captured output was truncated before a clear summary was found."
      ].join("\n")
    );
  });

  it("adds a generic preset hint to insufficient text responses", async () => {
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi
        .fn()
        .mockResolvedValue({ text: "Insufficient signal in the provided input." })
    });
    const { runSift } = await import("../src/core/run.js");

    await expect(
      runSift(makeRequest({ presetName: "lint-failures", policyName: "lint-failures" }))
    ).resolves.toBe(
      [
        "Insufficient signal in the provided input.",
        "Hint: the captured output did not contain a clear answer for this preset."
      ].join("\n")
    );
  });

  it("uses provider follow-up for incomplete test-status diagnosis and merges the supplement contract", async () => {
    const incompleteTestStatus = [
      "=========================== short test summary info ============================",
      "FAILED tests/unit/test_auth.py::test_refresh",
      "============================== 1 failed in 0.10s =============================="
    ].join("\n");

    prepareInputMock.mockReturnValue({
      raw: incompleteTestStatus,
      sanitized: incompleteTestStatus,
      redacted: incompleteTestStatus,
      truncated: incompleteTestStatus,
      meta: {
        originalLength: incompleteTestStatus.length,
        finalLength: incompleteTestStatus.length,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    buildPromptMock.mockReturnValue({
      prompt: "PROMPT",
      responseMode: "json"
    });
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          diagnosis_complete: true,
          raw_needed: false,
          additional_source_read_likely_low_value: true,
          read_raw_only_if: null,
          decision: "read_source",
          provider_confidence: 0.58,
          bucket_supplements: [
            {
              label: "runtime failure",
              count: 1,
              root_cause: "TypeError: refresh token payload is undefined",
              anchor: {
                file: "tests/unit/test_auth.py",
                line: 21,
                search_hint: null
              },
              fix_hint: "Inspect the refresh token payload setup before rerunning the full suite at standard.",
              confidence: 0.7
            }
          ],
          next_best_action: {
            code: "read_source_for_bucket",
            bucket_index: 1,
            note: "Read tests/unit/test_auth.py:21 next."
          }
        })
      })
    });
    const { runSift } = await import("../src/core/run.js");

    const output = await runSift(
      makeRequest({
        policyName: "test-status",
        presetName: "test-status",
        goal: "diagnose",
        format: "json",
        config: {
          ...defaultConfig,
          input: {
            ...defaultConfig.input,
            maxInputChars: 80,
            headChars: 40,
            tailChars: 20
          }
        }
      })
    );
    const parsed = JSON.parse(output) as {
      diagnosis_complete: boolean;
      decision: string;
      provider_used: boolean;
      provider_confidence: number;
      provider_failed: boolean;
      raw_slice_used: boolean;
      raw_slice_strategy: string;
      main_buckets: Array<{ label: string; root_cause: string }>;
      next_best_action: { note: string };
    };

    expect(parsed.diagnosis_complete).toBe(true);
    expect(parsed.decision).toBe("read_source");
    expect(parsed.provider_used).toBe(true);
    expect(parsed.provider_confidence).toBe(0.58);
    expect(parsed.provider_failed).toBe(false);
    expect(parsed.raw_slice_used).toBe(true);
    expect(parsed.raw_slice_strategy).toBe("bucket_evidence");
    expect(parsed.main_buckets[0]).toMatchObject({
      label: "runtime failure",
      root_cause: "TypeError: refresh token payload is undefined"
    });
    expect(parsed.next_best_action.note).toContain("tests/unit/test_auth.py");
    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outputContract: expect.stringContaining('"provider_confidence":number|null')
      })
    );
    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outputContract: expect.stringContaining('"bucket_supplements"')
      })
    );
    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisContext: expect.stringContaining("remaining_summary=")
      })
    );
    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisContext: expect.not.stringContaining("remaining_tests=")
      })
    );
  });

  it("keeps unknown buckets and avoids false complete when provider cannot classify the residual family", async () => {
    const vitestLikeOutput = [
      " FAIL  src/auth.test.ts > refresh token > throws on empty payload",
      " FAIL  src/routes.test.ts > landing page > renders hero",
      " Test Files  2 failed",
      "      Tests  2 failed"
    ].join("\n");

    prepareInputMock.mockReturnValue({
      raw: vitestLikeOutput,
      sanitized: vitestLikeOutput,
      redacted: vitestLikeOutput,
      truncated: vitestLikeOutput,
      meta: {
        originalLength: vitestLikeOutput.length,
        finalLength: vitestLikeOutput.length,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    buildPromptMock.mockReturnValue({
      prompt: "PROMPT",
      responseMode: "json"
    });
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          diagnosis_complete: false,
          raw_needed: false,
          additional_source_read_likely_low_value: false,
          read_raw_only_if: null,
          decision: "zoom",
          provider_confidence: 0.41,
          bucket_supplements: [],
          next_best_action: {
            code: "insufficient_signal",
            bucket_index: 1,
            note: "Take one deeper sift zoom step before raw."
          }
        })
      })
    });

    const { runSift } = await import("../src/core/run.js");
    const output = await runSift(
      makeRequest({
        policyName: "test-status",
        presetName: "test-status"
      })
    );

    expect(output).toContain("unknown failure family");
    expect(output).toContain("Decision: zoom");
    expect(output).not.toContain("Decision: stop and act");
  });

  it("returns a structured provider failure decision for incomplete test-status runs", async () => {
    const incompleteTestStatus = [
      "=========================== short test summary info ============================",
      "FAILED tests/unit/test_auth.py::test_refresh",
      "============================== 1 failed in 0.10s =============================="
    ].join("\n");

    prepareInputMock.mockReturnValue({
      raw: incompleteTestStatus,
      sanitized: incompleteTestStatus,
      redacted: incompleteTestStatus,
      truncated: incompleteTestStatus,
      meta: {
        originalLength: incompleteTestStatus.length,
        finalLength: incompleteTestStatus.length,
        redactionApplied: false,
        truncatedApplied: false
      }
    });
    buildPromptMock.mockReturnValue({
      prompt: "PROMPT",
      responseMode: "json"
    });
    createProviderMock.mockReturnValue({
      name: "openai",
      generate: vi.fn().mockRejectedValue(new Error("HTTP 503"))
    });
    const { runSift } = await import("../src/core/run.js");

    const output = await runSift(
      makeRequest({
        policyName: "test-status",
        presetName: "test-status",
        goal: "diagnose",
        format: "json"
      })
    );
    const parsed = JSON.parse(output) as {
      diagnosis_complete: boolean;
      raw_needed: boolean;
      decision: string;
      provider_used: boolean;
      provider_failed: boolean;
      provider_confidence: number | null;
      next_best_action: { note: string };
    };

    expect(parsed.diagnosis_complete).toBe(false);
    expect(parsed.raw_needed).toBe(true);
    expect(parsed.decision).toBe("zoom");
    expect(parsed.provider_used).toBe(true);
    expect(parsed.provider_failed).toBe(true);
    expect(parsed.provider_confidence).toBeNull();
    expect(parsed.next_best_action.note).toContain("Provider follow-up failed (HTTP 503)");
  });
});
