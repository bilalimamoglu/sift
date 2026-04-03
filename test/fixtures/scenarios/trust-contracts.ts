import { z } from "zod";

const trustPlanSchema = z.enum(["08-01", "08-02", "08-03"]);
const trustSurfaceSchema = z.enum([
  "gain-report",
  "discover-report",
  "insufficient-hint",
  "diagnose-public-json"
]);
const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const trustRegressionAssertionSchema = z
  .object({
    contains: z.array(z.string().min(1)).optional(),
    notContains: z.array(z.string().min(1)).optional(),
    jsonEquals: z
      .array(
        z.object({
          path: z.string().min(1),
          value: jsonPrimitiveSchema
        })
      )
      .optional(),
    jsonIncludes: z
      .array(
        z.object({
          path: z.string().min(1),
          value: z.string().min(1)
        })
      )
      .optional()
  })
  .refine(
    (value) =>
      Boolean(
        value.contains?.length ||
          value.notContains?.length ||
          value.jsonEquals?.length ||
          value.jsonIncludes?.length
      ),
    {
      message: "At least one assertion is required."
    }
  );

export const trustRegressionManifestSchema = z.object({
  id: z.string().min(1),
  family: z.literal("trust-regression"),
  title: z.string().min(1),
  description: z.string().min(1),
  coversPlans: z.array(trustPlanSchema).min(1),
  surface: trustSurfaceSchema,
  fixtureRef: z.string().min(1),
  assertions: trustRegressionAssertionSchema
});

export const trustHistoryFixtureSchema = z.object({
  events: z.array(z.any()),
  byPreset: z.boolean().optional(),
  days: z.number().int().positive().optional()
});

export const trustInsufficientFixtureSchema = z.object({
  input: z.object({
    presetName: z.string().optional(),
    originalLength: z.number().int().nonnegative(),
    truncatedApplied: z.boolean(),
    exitCode: z.number().int().optional(),
    recognizedRunner: z.enum(["pytest", "vitest", "jest", "unknown"]).optional(),
    inputText: z.string().optional()
  })
});

export const trustDiagnoseFixtureSchema = z.object({
  rawOutput: z.string().min(1),
  remainingSubsetAvailable: z.boolean().optional(),
  includeTestIds: z.boolean().optional(),
  resolvedTests: z.array(z.string()).optional(),
  remainingTests: z.array(z.string()).optional()
});

export type TrustRegressionManifest = z.infer<typeof trustRegressionManifestSchema>;
export type TrustRegressionSurface = z.infer<typeof trustSurfaceSchema>;
export type TrustHistoryFixture = z.infer<typeof trustHistoryFixtureSchema>;
export type TrustInsufficientFixture = z.infer<typeof trustInsufficientFixtureSchema>;
export type TrustDiagnoseFixture = z.infer<typeof trustDiagnoseFixtureSchema>;
