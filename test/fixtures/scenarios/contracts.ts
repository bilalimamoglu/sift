import { z } from "zod";

export const scenarioRenderSchema = z.object({
  id: z.string().min(1),
  renderMode: z.enum(["standard", "diagnose-json"]),
  docsSlug: z.string().min(1),
  title: z.string().min(1),
  companionOutputPath: z.string().min(1)
});

export const scenarioManifestSchema = z.object({
  id: z.string().min(1),
  family: z.string().min(1),
  fixtureName: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  sourceType: z.enum(["synthetic-derived", "repo-captured"]),
  rawPath: z.string().min(1),
  renders: z.array(scenarioRenderSchema).min(1)
});

export type ScenarioRender = z.infer<typeof scenarioRenderSchema>;
export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;
