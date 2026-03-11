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
vi.mock("../src/core/heuristics.js", () => ({
  applyHeuristicPolicy: applyHeuristicPolicyMock
}));
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
    applyHeuristicPolicyMock.mockReturnValue("- Tests passed.");
    const { runSift } = await import("../src/core/run.js");

    const output = await runSift(makeRequest({ dryRun: true, policyName: "test-status" }));
    const parsed = JSON.parse(output);

    expect(parsed.status).toBe("dry-run");
    expect(parsed.strategy).toBe("heuristic");
    expect(parsed.heuristicOutput).toBe("- Tests passed.");
  });

  it("logs heuristic usage in verbose mode", async () => {
    applyHeuristicPolicyMock.mockReturnValue("- Tests passed.");
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
    ).resolves.toBe("- Tests passed.");

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
});
