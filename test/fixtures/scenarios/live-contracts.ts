import { z } from "zod";

export const liveStopDepthSchema = z.enum(["standard", "focused", "verbose", "raw"]);

export const liveSessionFlowFixtureSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  consumedChars: z.number().int().nonnegative(),
  externalToolCalls: z.number().int().nonnegative(),
  internalToolUses: z.number().int().nonnegative(),
  wallClockSeconds: z.number().nonnegative(),
  providerInvocations: z.number().int().nonnegative().nullable(),
  stopDepth: liveStopDepthSchema,
  diagnosisCorrect: z.boolean()
});

export const liveSessionSiftFlowFixtureSchema = liveSessionFlowFixtureSchema.extend({
  standardSurfacedDominantBlocker: z.boolean(),
  standardSurfacedSecondaryBucket: z.boolean(),
  standardSelfSufficientForVisibleBuckets: z.boolean(),
  sourceReadCount: z.number().int().nonnegative().nullable(),
  firstSourceReadCoveredByReadTargets: z.boolean().nullable(),
  firstSourceReadNarrowedByContextHint: z.boolean().nullable(),
  rawReverificationAvoided: z.boolean(),
  sourceReadsStayedTargeted: z.boolean(),
  sourceReadAfterZoomSteps: z.number().int().nonnegative().nullable(),
  remainingIdsExposedPublicly: z.boolean(),
  diagnosisCompleteAtLayer: z.enum(["heuristic", "provider", "raw"])
});

export const liveSessionCaptureSchema = z.object({
  sourceType: z.enum(["captured-session"]),
  measuredBy: z.enum(["manual-scorecard"]),
  tokenMethod: z.enum(["session-estimate"]),
  notes: z.string().min(1).optional()
});

export const liveSessionManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  capture: liveSessionCaptureSchema,
  rawFirst: liveSessionFlowFixtureSchema,
  siftFirst: liveSessionSiftFlowFixtureSchema
});

export type LiveStopDepth = z.infer<typeof liveStopDepthSchema>;
export type LiveSessionFlowFixture = z.infer<typeof liveSessionFlowFixtureSchema>;
export type LiveSessionSiftFlowFixture = z.infer<typeof liveSessionSiftFlowFixtureSchema>;
export type LiveSessionFixture = z.infer<typeof liveSessionManifestSchema>;
