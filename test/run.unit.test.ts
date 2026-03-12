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
          diagnosis_complete: false,
          raw_needed: false,
          additional_source_read_likely_low_value: false,
          read_raw_only_if: null,
          decision: "zoom",
          provider_confidence: 0.58,
          next_best_action: {
            code: "insufficient_signal",
            bucket_index: null,
            note: "Take one deeper sift zoom step before raw."
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
      next_best_action: { note: string };
    };

    expect(parsed.diagnosis_complete).toBe(false);
    expect(parsed.decision).toBe("zoom");
    expect(parsed.provider_used).toBe(true);
    expect(parsed.provider_confidence).toBe(0.58);
    expect(parsed.provider_failed).toBe(false);
    expect(parsed.raw_slice_used).toBe(true);
    expect(parsed.raw_slice_strategy).toBe("bucket_evidence");
    expect(parsed.next_best_action.note).toContain("deeper sift zoom");
    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outputContract: expect.stringContaining('"provider_confidence":number|null')
      })
    );
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
