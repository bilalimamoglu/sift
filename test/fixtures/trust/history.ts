import type { HistoryEvent } from "../../../src/types.js";

export interface TrustHistoryFixture {
  events: HistoryEvent[];
  byPreset?: boolean;
  days?: number;
}

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

export const gainBuildFailureContaminationFixture: TrustHistoryFixture = {
  byPreset: true,
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
  ]
};

export const discoverTrivialTypecheckMissesFixture: TrustHistoryFixture = {
  days: 7,
  events: Array.from({ length: 6 }, (_, index) =>
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
  )
};
