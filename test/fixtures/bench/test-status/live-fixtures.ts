import type { DetailLevel } from "../../../../src/types.js";

export type LiveStopDepth = DetailLevel | "raw";

export interface LiveSessionFlowFixture {
  totalTokens: number;
  consumedChars: number;
  externalToolCalls: number;
  internalToolUses: number;
  wallClockSeconds: number;
  providerInvocations: number | null;
  stopDepth: LiveStopDepth;
  diagnosisCorrect: boolean;
}

export interface LiveSessionSiftFlowFixture extends LiveSessionFlowFixture {
  standardSurfacedDominantBlocker: boolean;
  standardSurfacedSecondaryBucket: boolean;
  sourceReadAfterZoomSteps: number | null;
}

export interface LiveSessionFixture {
  name: string;
  description: string;
  rawFirst: LiveSessionFlowFixture;
  siftFirst: LiveSessionSiftFlowFixture;
}

export function buildLiveSessionFixtures(): LiveSessionFixture[] {
  return [
    {
      name: "mixed-full-suite-live",
      description:
        "Captured mixed full-suite agent session comparing raw pytest against sift-first diagnosis.",
      rawFirst: {
        totalTokens: 86299,
        consumedChars: 120000,
        externalToolCalls: 17,
        internalToolUses: 32,
        wallClockSeconds: 227,
        providerInvocations: 0,
        stopDepth: "raw",
        diagnosisCorrect: true
      },
      siftFirst: {
        totalTokens: 57373,
        consumedChars: 50000,
        externalToolCalls: 18,
        internalToolUses: 72,
        wallClockSeconds: 448,
        providerInvocations: null,
        stopDepth: "verbose",
        diagnosisCorrect: true,
        standardSurfacedDominantBlocker: false,
        standardSurfacedSecondaryBucket: true,
        sourceReadAfterZoomSteps: 2
      }
    }
  ];
}
