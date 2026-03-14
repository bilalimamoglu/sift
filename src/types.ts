export type ProviderName = "openai" | "openai-compatible" | "openrouter";
export type NativeProviderName = "openai" | "openrouter";

export interface ProviderProfile {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export type ProviderProfiles = Partial<Record<NativeProviderName, ProviderProfile>>;

export type OutputFormat = "brief" | "bullets" | "json" | "verdict";
export type DetailLevel = "standard" | "focused" | "verbose";
export type Goal = "summarize" | "diagnose";
export type RawSliceStrategy = "none" | "bucket_evidence" | "traceback_window" | "head_tail";

export type ResponseMode = "text" | "json";
export type JsonResponseFormatMode = "auto" | "on" | "off";

export type PromptPolicyName =
  | "test-status"
  | "audit-critical"
  | "diff-summary"
  | "build-failure"
  | "log-errors"
  | "infra-risk"
  | "typecheck-summary"
  | "lint-failures";

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  baseUrl: string;
  apiKey?: string;
  jsonResponseFormat: JsonResponseFormatMode;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
}

export interface InputConfig {
  stripAnsi: boolean;
  redact: boolean;
  redactStrict: boolean;
  maxCaptureChars: number;
  maxInputChars: number;
  headChars: number;
  tailChars: number;
}

export interface RuntimeConfig {
  rawFallback: boolean;
  verbose: boolean;
}

export interface PresetDefinition {
  question: string;
  format: OutputFormat;
  policy?: PromptPolicyName;
  outputContract?: string;
  fallbackJson?: unknown;
}

export interface SiftConfig {
  provider: ProviderConfig;
  input: InputConfig;
  runtime: RuntimeConfig;
  presets: Record<string, PresetDefinition>;
  providerProfiles?: ProviderProfiles;
}

export interface PartialSiftConfig {
  provider?: Partial<ProviderConfig>;
  input?: Partial<InputConfig>;
  runtime?: Partial<RuntimeConfig>;
  presets?: Record<string, PresetDefinition>;
  providerProfiles?: ProviderProfiles;
}

export interface GenerateInput {
  model: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  responseMode: ResponseMode;
  jsonResponseFormat: JsonResponseFormatMode;
}

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface GenerateResult {
  text: string;
  usage?: UsageInfo;
  raw?: unknown;
}

export interface RunRequest {
  question: string;
  format: OutputFormat;
  stdin: string;
  config: SiftConfig;
  goal?: Goal;
  dryRun?: boolean;
  showRaw?: boolean;
  includeTestIds?: boolean;
  detail?: DetailLevel;
  presetName?: string;
  policyName?: PromptPolicyName;
  outputContract?: string;
  analysisContext?: string;
  testStatusContext?: {
    resolvedTests?: string[];
    remainingTests?: string[];
    remainingSubsetAvailable?: boolean;
  };
  fallbackJson?: unknown;
}

export interface PreparedInput {
  raw: string;
  sanitized: string;
  redacted: string;
  truncated: string;
  meta: {
    originalLength: number;
    finalLength: number;
    redactionApplied: boolean;
    truncatedApplied: boolean;
  };
}
