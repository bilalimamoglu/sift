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
    inputChars: 400,
    outputChars: 120,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 30,
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
    expect(summary.insufficientRuns).toBe(1);
    expect(summary.safetySuppressionRuns).toBe(1);
    expect(summary.measuredDurationRuns).toBe(3);
    expect(report).toContain("Sift gain (all local history)");
    expect(report).toContain("Estimated output reduction");
    expect(report).toContain("Observed runtime:");
    expect(report).toContain("Top presets:");
    expect(report).toContain("Notes: size/token savings are local estimates");
  });

  it("keeps discover quiet on thin evidence and emits hints only on repeated patterns", () => {
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
