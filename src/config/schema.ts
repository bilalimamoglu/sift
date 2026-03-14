import { z } from "zod";

export const providerNameSchema = z.enum([
  "openai",
  "openai-compatible",
  "openrouter"
]);
export const outputFormatSchema = z.enum([
  "brief",
  "bullets",
  "json",
  "verdict"
]);
export const responseModeSchema = z.enum(["text", "json"]);
export const jsonResponseFormatModeSchema = z.enum(["auto", "on", "off"]);
export const promptPolicyNameSchema = z.enum([
  "test-status",
  "audit-critical",
  "diff-summary",
  "build-failure",
  "log-errors",
  "infra-risk",
  "typecheck-summary",
  "lint-failures"
]);

export const providerConfigSchema = z.object({
  provider: providerNameSchema,
  model: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  jsonResponseFormat: jsonResponseFormatModeSchema,
  timeoutMs: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().positive()
});

export const providerProfileSchema = z.object({
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional()
});

export const providerProfilesSchema = z
  .object({
    openai: providerProfileSchema.optional(),
    openrouter: providerProfileSchema.optional()
  })
  .optional();

export const inputConfigSchema = z.object({
  stripAnsi: z.boolean(),
  redact: z.boolean(),
  redactStrict: z.boolean(),
  maxCaptureChars: z.number().int().positive(),
  maxInputChars: z.number().int().positive(),
  headChars: z.number().int().positive(),
  tailChars: z.number().int().positive()
});

export const runtimeConfigSchema = z.object({
  rawFallback: z.boolean(),
  verbose: z.boolean()
});

export const presetDefinitionSchema = z.object({
  question: z.string().min(1),
  format: outputFormatSchema,
  policy: promptPolicyNameSchema.optional(),
  outputContract: z.string().optional(),
  fallbackJson: z.unknown().optional()
});

export const siftConfigSchema = z.object({
  provider: providerConfigSchema,
  input: inputConfigSchema,
  runtime: runtimeConfigSchema,
  presets: z.record(presetDefinitionSchema),
  providerProfiles: providerProfilesSchema
});

export type SiftConfigSchema = z.infer<typeof siftConfigSchema>;
