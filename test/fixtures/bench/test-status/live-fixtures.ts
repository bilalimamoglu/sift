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
  standardSelfSufficientForVisibleBuckets: boolean;
  sourceReadCount: number | null;
  firstSourceReadCoveredByReadTargets: boolean | null;
  firstSourceReadNarrowedByContextHint: boolean | null;
  rawReverificationAvoided: boolean;
  sourceReadsStayedTargeted: boolean;
  sourceReadAfterZoomSteps: number | null;
  remainingIdsExposedPublicly: boolean;
  diagnosisCompleteAtLayer: "heuristic" | "provider" | "raw";
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
        totalTokens: 63206,
        consumedChars: 75000,
        externalToolCalls: 14,
        internalToolUses: 34,
        wallClockSeconds: 330,
        providerInvocations: 0,
        stopDepth: "raw",
        diagnosisCorrect: true
      },
      siftFirst: {
        totalTokens: 47573,
        consumedChars: 35000,
        externalToolCalls: 9,
        internalToolUses: 24,
        wallClockSeconds: 297,
        providerInvocations: null,
        stopDepth: "standard",
        diagnosisCorrect: true,
        standardSurfacedDominantBlocker: true,
        standardSurfacedSecondaryBucket: true,
        standardSelfSufficientForVisibleBuckets: true,
        sourceReadCount: 3,
        firstSourceReadCoveredByReadTargets: true,
        firstSourceReadNarrowedByContextHint: null,
        rawReverificationAvoided: true,
        sourceReadsStayedTargeted: true,
        sourceReadAfterZoomSteps: 0,
        remainingIdsExposedPublicly: false,
        diagnosisCompleteAtLayer: "heuristic"
      }
    }
  ];
}
