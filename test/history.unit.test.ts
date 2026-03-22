import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDiscoverHints,
  clearHistory,
  readHistoryEvents,
  recordHistoryEvent,
  renderDiscoverReport,
  renderGainReport,
  summarizeHistory
} from "../src/core/history.js";
import { defaultConfig } from "../src/config/defaults.js";
import type { HistoryEvent } from "../src/types.js";

function buildEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    version: 1,
    timestamp: "2026-03-22T10:00:00.000Z",
    cwdHash: "abc123def456",
    cwdLabel: "sift",
    entrypoint: "exec",
    operationMode: "agent-escalation",
    commandFamily: "pytest",
    presetName: "test-status",
    candidatePresetName: "test-status",
    providerCalled: false,
    layer: "heuristic",
    detail: null,
    resultKind: "reduced",
    inputChars: 4_000,
    outputChars: 600,
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 150,
    exactProviderTokens: null,
    durationMs: 42,
    safetySuppressedLineCount: 0,
    ...overrides
  };
}

describe("history core", () => {
  it("records and reads local metadata history without raw logs", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-history-home-"));

    await recordHistoryEvent({
      cwd: "/tmp/example-project",
      entrypoint: "exec",
      operationMode: "agent-escalation",
      commandFamily: "pytest",
      presetName: "test-status",
      candidatePresetName: "test-status",
      providerCalled: false,
      layer: "heuristic",
      resultKind: "reduced",
      inputChars: 1200,
      outputChars: 240,
      historyConfig: defaultConfig.history,
      homeDir,
      now: new Date("2026-03-22T10:00:00.000Z")
    });

    const events = await readHistoryEvents({
      homeDir
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.cwdLabel).toBe("example-project");
    expect(events[0]?.commandFamily).toBe("pytest");
    expect(events[0]).not.toHaveProperty("raw");
    expect(events[0]).not.toHaveProperty("output");
  });

  it("summarizes local gain honestly", () => {
    const summary = summarizeHistory([
      buildEvent(),
      buildEvent({
        presetName: "typecheck-summary",
        commandFamily: "npm run typecheck",
        candidatePresetName: "typecheck-summary",
        inputChars: 8_000,
        outputChars: 1_200,
        estimatedInputTokens: 2_000,
        estimatedOutputTokens: 300,
        safetySuppressedLineCount: 1
      }),
      buildEvent({
        resultKind: "insufficient",
        providerCalled: true,
        layer: "provider",
        exactProviderTokens: 72
      })
    ]);

    const report = renderGainReport({
      summary,
      events: [
        buildEvent(),
        buildEvent({
          presetName: "typecheck-summary",
          commandFamily: "npm run typecheck",
          candidatePresetName: "typecheck-summary",
          inputChars: 800,
          outputChars: 200,
          estimatedInputTokens: 200,
          estimatedOutputTokens: 50,
          safetySuppressedLineCount: 1
        }),
        buildEvent({
          resultKind: "insufficient",
          providerCalled: true,
          layer: "provider",
          exactProviderTokens: 72
        })
      ],
      byPreset: true
    });

    expect(summary.totalRuns).toBe(3);
    expect(summary.meaningfulRuns).toBe(3);
    expect(summary.lowSignalRuns).toBe(0);
    expect(summary.insufficientRuns).toBe(1);
    expect(summary.safetySuppressionRuns).toBe(1);
    expect(summary.measuredDurationRuns).toBe(3);
    expect(report).toContain("Sift gain (all local history)");
    expect(report).toContain("Meaningful runs: 3");
    expect(report).toContain("Low-signal runs: 0");
    expect(report).toContain("Estimated output reduction");
    expect(report).toContain("Observed runtime:");
    expect(report).toContain("Top presets:");
    expect(report).toContain("evidence is still exploratory");
    expect(report).toContain("Notes: size/token savings above use meaningful runs only.");
  });

  it("keeps discover quiet on thin evidence and emits hints only on repeated meaningful patterns", () => {
    const thinEvents = [buildEvent(), buildEvent(), buildEvent(), buildEvent()];
    expect(buildDiscoverHints(thinEvents)).toEqual([]);
    expect(
      renderDiscoverReport({
        events: thinEvents,
        hints: [],
        days: 7
      })
    ).toContain("Not enough local history yet for discover.");

    const repeatedPresetMisses = Array.from({ length: 3 }, (_, index) =>
      buildEvent({
        timestamp: `2026-03-22T10:00:0${index}.000Z`,
        commandFamily: "npm run typecheck",
        presetName: null,
        candidatePresetName: "typecheck-summary"
      })
    );
    const repeatedExplicitRuns = Array.from({ length: 5 }, (_, index) =>
      buildEvent({
        timestamp: `2026-03-22T10:01:0${index}.000Z`,
        entrypoint: "exec",
        commandFamily: "pytest",
        presetName: "test-status",
        candidatePresetName: "test-status"
      })
    );

    const hints = buildDiscoverHints([...repeatedPresetMisses, ...repeatedExplicitRuns]);
    const report = renderDiscoverReport({
      events: [...repeatedPresetMisses, ...repeatedExplicitRuns],
      hints
    });

    expect(hints).toHaveLength(2);
    expect(report).toContain("Sift discover (all local history)");
    expect(report).toContain("Built-in preset fit: typecheck-summary");
    expect(report).toContain("Repeated explicit pytest runs");
  });

  it("filters tiny high-contamination preset samples out of strategic gain conclusions", () => {
    const summary = summarizeHistory([
      buildEvent({
        presetName: "build-failure",
        commandFamily: "node",
        inputChars: 10,
        outputChars: 14,
        estimatedInputTokens: 3,
        estimatedOutputTokens: 4
      }),
      buildEvent({
        presetName: "build-failure",
        commandFamily: "node",
        inputChars: 12,
        outputChars: 14,
        estimatedInputTokens: 3,
        estimatedOutputTokens: 4
      }),
      buildEvent({
        presetName: "typecheck-summary",
        commandFamily: "npm run typecheck",
        inputChars: 120,
        outputChars: 40,
        estimatedInputTokens: 30,
        estimatedOutputTokens: 10
      })
    ]);

    const report = renderGainReport({
      summary,
      events: [
        buildEvent({
          presetName: "build-failure",
          commandFamily: "node",
          inputChars: 10,
          outputChars: 14,
          estimatedInputTokens: 3,
          estimatedOutputTokens: 4
        }),
        buildEvent({
          presetName: "build-failure",
          commandFamily: "node",
          inputChars: 12,
          outputChars: 14,
          estimatedInputTokens: 3,
          estimatedOutputTokens: 4
        }),
        buildEvent({
          presetName: "typecheck-summary",
          commandFamily: "npm run typecheck",
          inputChars: 120,
          outputChars: 40,
          estimatedInputTokens: 30,
          estimatedOutputTokens: 10
        })
      ],
      byPreset: true
    });

    expect(summary.meaningfulRuns).toBe(0);
    expect(summary.lowSignalRuns).toBe(3);
    expect(summary.topPresets[0]?.confidenceBucket).toBe("exploratory");
    expect(summary.topPresets[0]?.contaminationRate).toBe(1);
    expect(report).toContain("Low-signal runs: 3");
    expect(report).toContain("Confidence note:");
    expect(report).toContain("build-failure: 2 run(s), 0 meaningful, 2 low-signal, evidence is still exploratory, 100% low-signal contamination");
    expect(report).toContain("roughly neutral");
  });

  it("keeps discover quiet when repeated misses are still trivial", () => {
    const trivialMisses = Array.from({ length: 6 }, (_, index) =>
      buildEvent({
        timestamp: `2026-03-22T10:02:0${index}.000Z`,
        commandFamily: "npm run typecheck",
        presetName: null,
        candidatePresetName: "typecheck-summary",
        inputChars: 120,
        outputChars: 30,
        estimatedInputTokens: 30,
        estimatedOutputTokens: 8
      })
    );

    const hints = buildDiscoverHints(trivialMisses);
    expect(hints).toEqual([]);
    expect(
      renderDiscoverReport({
        events: trivialMisses,
        hints
      })
    ).toContain("No strong discover hints");
  });

  it("clears local history state", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-history-clear-"));

    await recordHistoryEvent({
      cwd: "/tmp/example-project",
      entrypoint: "exec",
      operationMode: "agent-escalation",
      commandFamily: "pytest",
      presetName: "test-status",
      candidatePresetName: "test-status",
      providerCalled: false,
      layer: "heuristic",
      resultKind: "reduced",
      inputChars: 1200,
      outputChars: 240,
      historyConfig: defaultConfig.history,
      homeDir,
      now: new Date("2026-03-22T10:00:00.000Z")
    });

    await clearHistory({
      homeDir
    });

    await expect(
      readHistoryEvents({
        homeDir
      })
    ).resolves.toEqual([]);
  });
});
