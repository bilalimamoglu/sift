import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type {
  DetailLevel,
  HistoryConfig,
  HistoryEntrypoint,
  HistoryEvent,
  HistoryResultKind,
  OperationMode,
  RunLayer
} from "../types.js";
import { getDefaultHistoryEventsDir } from "../constants.js";

const HISTORY_VERSION = 1 as const;

export interface RecordHistoryEventInput {
  cwd: string;
  entrypoint: HistoryEntrypoint;
  operationMode: OperationMode;
  commandFamily?: string | null;
  presetName?: string | null;
  candidatePresetName?: string | null;
  providerCalled: boolean;
  layer: RunLayer;
  detail?: DetailLevel | null;
  resultKind: HistoryResultKind;
  inputChars: number;
  outputChars: number;
  exactProviderTokens?: number | null;
  durationMs?: number | null;
  safetySuppressedLineCount?: number;
  historyConfig: HistoryConfig;
  homeDir?: string;
  now?: Date;
}

export interface GainPresetSummary {
  presetName: string;
  runs: number;
  meaningfulRuns: number;
  lowSignalRuns: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  providerSkippedRuns: number;
  confidenceBucket: GainConfidenceBucket;
  contaminationRate: number;
  signalDirection: "positive" | "mixed" | "neutral";
}

export interface GainSummary {
  totalRuns: number;
  meaningfulRuns: number;
  lowSignalRuns: number;
  reducedRuns: number;
  providerSkippedRuns: number;
  insufficientRuns: number;
  passThroughRuns: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedInputChars: number;
  estimatedOutputChars: number;
  exactProviderTokens: number | null;
  measuredDurationRuns: number;
  totalDurationMs: number | null;
  safetySuppressionRuns: number;
  topPresets: GainPresetSummary[];
}

export type GainConfidenceBucket = "exploratory" | "emerging" | "credible" | "decision-grade";

type WorkloadSizeBucket = "tiny" | "small" | "medium" | "large" | "very-large";
type WorkloadMeaningfulness = "trivial" | "potentially-meaningful" | "meaningful" | "highly-meaningful";

interface EventEvidenceAssessment {
  sizeBucket: WorkloadSizeBucket;
  meaningfulness: WorkloadMeaningfulness;
  lowSignal: boolean;
  discoverEligible: boolean;
  strategyEligible: boolean;
}

interface PresetEvidenceSummary {
  presetName: string;
  runs: number;
  meaningfulRuns: number;
  lowSignalRuns: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  providerSkippedRuns: number;
  signalDirection: "positive" | "mixed" | "neutral";
  confidenceBucket: GainConfidenceBucket;
  contaminationRate: number;
}

export interface DiscoverHint {
  id: string;
  title: string;
  body: string;
  command: string;
  evidenceCount: number;
}

export interface HistoryReadOptions {
  homeDir?: string;
  now?: Date;
  days?: number;
}

function estimateTokenCount(textLength: number): number {
  return Math.max(1, Math.ceil(textLength / 4));
}

function classifyWorkloadSize(event: Pick<HistoryEvent, "inputChars" | "estimatedInputTokens">): WorkloadSizeBucket {
  if (event.inputChars >= 50_000 || event.estimatedInputTokens >= 12_500) {
    return "very-large";
  }
  if (event.inputChars >= 10_000 || event.estimatedInputTokens >= 2_500) {
    return "large";
  }
  if (event.inputChars >= 2_000 || event.estimatedInputTokens >= 500) {
    return "medium";
  }
  if (event.inputChars >= 300 || event.estimatedInputTokens >= 75) {
    return "small";
  }
  return "tiny";
}

function hasHighTinyContaminationRisk(presetName: string | null): boolean {
  return presetName === "typecheck-summary" || presetName === "build-failure";
}

function assessHistoryEvent(event: HistoryEvent): EventEvidenceAssessment {
  const sizeBucket = classifyWorkloadSize(event);
  const highRiskPreset = hasHighTinyContaminationRisk(event.presetName);

  if (sizeBucket === "tiny") {
    return {
      sizeBucket,
      meaningfulness: "trivial",
      lowSignal: true,
      discoverEligible: false,
      strategyEligible: false
    };
  }

  if (highRiskPreset && sizeBucket === "small") {
    return {
      sizeBucket,
      meaningfulness: "trivial",
      lowSignal: true,
      discoverEligible: false,
      strategyEligible: false
    };
  }

  if (sizeBucket === "small") {
    return {
      sizeBucket,
      meaningfulness: "potentially-meaningful",
      lowSignal: true,
      discoverEligible: false,
      strategyEligible: false
    };
  }

  if (sizeBucket === "medium") {
    return {
      sizeBucket,
      meaningfulness: "meaningful",
      lowSignal: false,
      discoverEligible: true,
      strategyEligible: true
    };
  }

  return {
    sizeBucket,
    meaningfulness: "highly-meaningful",
    lowSignal: false,
    discoverEligible: true,
    strategyEligible: true
  };
}

function confidenceBucketForPreset(args: {
  meaningfulRuns: number;
  contaminationRate: number;
}): GainConfidenceBucket {
  if (args.meaningfulRuns >= 20 && args.contaminationRate < 0.2) {
    return "decision-grade";
  }
  if (args.meaningfulRuns >= 10 && args.contaminationRate < 0.35) {
    return "credible";
  }
  if (args.meaningfulRuns >= 5 && args.contaminationRate < 0.5) {
    return "emerging";
  }
  return "exploratory";
}

function signalDirectionForPreset(args: {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  meaningfulRuns: number;
}): "positive" | "mixed" | "neutral" {
  if (args.meaningfulRuns === 0) {
    return "neutral";
  }

  const delta = args.estimatedInputTokens - args.estimatedOutputTokens;
  if (delta > 0) {
    return "positive";
  }
  if (delta < 0) {
    return "mixed";
  }
  return "neutral";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function describeConfidenceBucket(bucket: GainConfidenceBucket): string {
  switch (bucket) {
    case "decision-grade":
      return "evidence looks decision-grade";
    case "credible":
      return "evidence looks credible";
    case "emerging":
      return "evidence is emerging";
    case "exploratory":
    default:
      return "evidence is still exploratory";
  }
}

function describeSignalDirection(direction: "positive" | "mixed" | "neutral"): string {
  switch (direction) {
    case "positive":
      return "usefulness looks positive so far";
    case "mixed":
      return "usefulness looks mixed so far";
    case "neutral":
    default:
      return "signal is still neutral so far";
  }
}

function buildCwdHash(cwd: string): string {
  return crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 12);
}

function buildCwdLabel(cwd: string): string {
  const base = path.basename(path.resolve(cwd));
  return base.length > 0 ? base : "root";
}

function getEventsFilePath(args: { homeDir?: string; now?: Date }): string {
  const timestamp = args.now ?? new Date();
  const dateSegment = timestamp.toISOString().slice(0, 10);
  return path.join(getDefaultHistoryEventsDir(args.homeDir ?? os.homedir()), `${dateSegment}.jsonl`);
}

function parseHistoryEvent(line: string): HistoryEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as HistoryEvent;
    if (parsed.version !== HISTORY_VERSION || typeof parsed.timestamp !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function pruneOldHistoryFiles(args: {
  homeDir?: string;
  retentionDays: number;
  now?: Date;
}): Promise<void> {
  const historyDir = getDefaultHistoryEventsDir(args.homeDir ?? os.homedir());
  let entries: string[] = [];

  try {
    entries = await fs.readdir(historyDir);
  } catch {
    return;
  }

  const cutoff = new Date(args.now ?? new Date());
  cutoff.setDate(cutoff.getDate() - args.retentionDays);

  await Promise.all(
    entries
      .filter((entry) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry))
      .map(async (entry) => {
        const datePart = entry.slice(0, 10);
        const fileDate = new Date(`${datePart}T00:00:00.000Z`);
        if (Number.isNaN(fileDate.getTime()) || fileDate >= cutoff) {
          return;
        }

        await fs.rm(path.join(historyDir, entry), { force: true });
      })
  );
}

export async function recordHistoryEvent(input: RecordHistoryEventInput): Promise<void> {
  if (!input.historyConfig.enabled) {
    return;
  }

  const now = input.now ?? new Date();
  const event: HistoryEvent = {
    version: HISTORY_VERSION,
    timestamp: now.toISOString(),
    cwdHash: buildCwdHash(input.cwd),
    cwdLabel: buildCwdLabel(input.cwd),
    entrypoint: input.entrypoint,
    operationMode: input.operationMode,
    commandFamily: input.commandFamily ?? null,
    presetName: input.presetName ?? null,
    candidatePresetName: input.candidatePresetName ?? null,
    providerCalled: input.providerCalled,
    layer: input.layer,
    detail: input.detail ?? null,
    resultKind: input.resultKind,
    inputChars: input.inputChars,
    outputChars: input.outputChars,
    estimatedInputTokens: estimateTokenCount(input.inputChars),
    estimatedOutputTokens: estimateTokenCount(input.outputChars),
    exactProviderTokens: input.exactProviderTokens ?? null,
    durationMs: input.durationMs ?? null,
    safetySuppressedLineCount: input.safetySuppressedLineCount ?? 0
  };

  const targetPath = getEventsFilePath({
    homeDir: input.homeDir,
    now
  });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.appendFile(targetPath, `${JSON.stringify(event)}\n`, "utf8");
  await pruneOldHistoryFiles({
    homeDir: input.homeDir,
    retentionDays: input.historyConfig.retentionDays,
    now
  });
}

export async function readHistoryEvents(options: HistoryReadOptions = {}): Promise<HistoryEvent[]> {
  const historyDir = getDefaultHistoryEventsDir(options.homeDir ?? os.homedir());
  let entries: string[] = [];

  try {
    entries = await fs.readdir(historyDir);
  } catch {
    return [];
  }

  const cutoff = options.days
    ? new Date((options.now ?? new Date()).getTime() - options.days * 24 * 60 * 60 * 1000)
    : null;

  const events: HistoryEvent[] = [];
  const files = entries
    .filter((entry) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry))
    .sort();

  for (const entry of files) {
    const content = await fs.readFile(path.join(historyDir, entry), "utf8");
    for (const line of content.split("\n")) {
      const event = parseHistoryEvent(line);
      if (!event) {
        continue;
      }

      if (cutoff && new Date(event.timestamp) < cutoff) {
        continue;
      }

      events.push(event);
    }
  }

  return events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function summarizeHistory(events: HistoryEvent[]): GainSummary {
  const presetMap = new Map<string, PresetEvidenceSummary>();
  let exactProviderTokens: number | null = 0;
  const assessments = events.map((event) => ({
    event,
    assessment: assessHistoryEvent(event)
  }));

  for (const { event, assessment } of assessments) {
    if (event.exactProviderTokens === null) {
      exactProviderTokens = null;
    }

    if (!event.presetName) {
      continue;
    }

    const current =
      presetMap.get(event.presetName) ??
      {
        presetName: event.presetName,
        runs: 0,
        meaningfulRuns: 0,
        lowSignalRuns: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        providerSkippedRuns: 0,
        confidenceBucket: "exploratory",
        contaminationRate: 0,
        signalDirection: "neutral"
      };

    current.runs += 1;
    current.meaningfulRuns += assessment.strategyEligible ? 1 : 0;
    current.lowSignalRuns += assessment.lowSignal ? 1 : 0;
    current.estimatedInputTokens += assessment.strategyEligible ? event.estimatedInputTokens : 0;
    current.estimatedOutputTokens += assessment.strategyEligible ? event.estimatedOutputTokens : 0;
    current.providerSkippedRuns += event.providerCalled ? 0 : 1;
    presetMap.set(event.presetName, current);
  }

  for (const preset of presetMap.values()) {
    preset.contaminationRate = preset.runs === 0 ? 0 : preset.lowSignalRuns / preset.runs;
    preset.confidenceBucket = confidenceBucketForPreset({
      meaningfulRuns: preset.meaningfulRuns,
      contaminationRate: preset.contaminationRate
    });
    preset.signalDirection = signalDirectionForPreset({
      estimatedInputTokens: preset.estimatedInputTokens,
      estimatedOutputTokens: preset.estimatedOutputTokens,
      meaningfulRuns: preset.meaningfulRuns
    });
  }

  return {
    totalRuns: events.length,
    meaningfulRuns: assessments.filter(({ assessment }) => assessment.strategyEligible).length,
    lowSignalRuns: assessments.filter(({ assessment }) => assessment.lowSignal).length,
    reducedRuns: events.filter((event) => event.resultKind === "reduced").length,
    providerSkippedRuns: events.filter((event) => !event.providerCalled).length,
    insufficientRuns: events.filter((event) => event.resultKind === "insufficient").length,
    passThroughRuns: events.filter((event) => event.resultKind === "pass-through").length,
    estimatedInputTokens: assessments.reduce(
      (sum, { event, assessment }) => sum + (assessment.strategyEligible ? event.estimatedInputTokens : 0),
      0
    ),
    estimatedOutputTokens: assessments.reduce(
      (sum, { event, assessment }) => sum + (assessment.strategyEligible ? event.estimatedOutputTokens : 0),
      0
    ),
    estimatedInputChars: assessments.reduce(
      (sum, { event, assessment }) => sum + (assessment.strategyEligible ? event.inputChars : 0),
      0
    ),
    estimatedOutputChars: assessments.reduce(
      (sum, { event, assessment }) => sum + (assessment.strategyEligible ? event.outputChars : 0),
      0
    ),
    exactProviderTokens:
      exactProviderTokens === null
        ? events.every((event) => event.exactProviderTokens === null)
          ? null
          : events.reduce((sum, event) => sum + (event.exactProviderTokens ?? 0), 0)
        : exactProviderTokens,
    measuredDurationRuns: events.filter((event) => event.durationMs !== null).length,
    totalDurationMs: events.every((event) => event.durationMs === null)
      ? null
      : events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0),
    safetySuppressionRuns: events.filter((event) => event.safetySuppressedLineCount > 0).length,
    topPresets: [...presetMap.values()]
      .sort(
        (left, right) =>
          right.estimatedInputTokens -
            right.estimatedOutputTokens -
            (left.estimatedInputTokens - left.estimatedOutputTokens) ||
          right.meaningfulRuns - left.meaningfulRuns ||
          right.runs - left.runs
      )
      .slice(0, 3)
  };
}

function suggestionCommandForPreset(presetName: string, commandFamily: string | null): string {
  switch (presetName) {
    case "test-status":
      return commandFamily === "python -m pytest"
        ? "sift exec --preset test-status -- python -m pytest -q"
        : "sift exec --preset test-status -- pytest -q";
    case "typecheck-summary":
      return "sift exec --preset typecheck-summary -- tsc --noEmit";
    case "lint-failures":
      return "sift exec --preset lint-failures -- eslint .";
    case "audit-critical":
      return commandFamily?.startsWith("pnpm")
        ? "sift exec --preset audit-critical -- pnpm audit"
        : commandFamily?.startsWith("yarn")
          ? "sift exec --preset audit-critical -- yarn audit"
          : commandFamily?.startsWith("bun")
            ? "sift exec --preset audit-critical -- bun audit"
            : "sift exec --preset audit-critical -- npm audit";
    case "infra-risk":
      return "sift exec --preset infra-risk -- terraform plan";
    case "diff-summary":
      return "sift exec --preset diff-summary -- git diff";
    default:
      return `sift exec --preset ${presetName} -- <command>`;
  }
}

export function buildDiscoverHints(events: HistoryEvent[]): DiscoverHint[] {
  if (events.length < 5) {
    return [];
  }

  const presetCandidateMap = new Map<string, { count: number; commandFamily: string | null }>();
  const hookCandidateMap = new Map<string, { count: number; presetName: string }>();

  for (const event of events) {
    const assessment = assessHistoryEvent(event);

    if (
      assessment.discoverEligible &&
      event.candidatePresetName &&
      event.candidatePresetName !== event.presetName &&
      event.entrypoint !== "hook"
    ) {
      const key = `${event.candidatePresetName}::${event.commandFamily ?? "unknown"}`;
      const current = presetCandidateMap.get(key) ?? {
        count: 0,
        commandFamily: event.commandFamily
      };
      current.count += 1;
      presetCandidateMap.set(key, current);
    }

    if (
      assessment.discoverEligible &&
      event.presetName &&
      event.entrypoint === "exec" &&
      event.commandFamily &&
      (event.commandFamily === "pytest" ||
        event.commandFamily === "python -m pytest" ||
        event.commandFamily === "vitest" ||
        event.commandFamily === "jest" ||
        event.commandFamily === "terraform plan" ||
        event.commandFamily === "git diff")
    ) {
      const key = `${event.commandFamily}::${event.presetName}`;
      const current = hookCandidateMap.get(key) ?? {
        count: 0,
        presetName: event.presetName
      };
      current.count += 1;
      hookCandidateMap.set(key, current);
    }
  }

  const hints: DiscoverHint[] = [];

  for (const [key, value] of presetCandidateMap.entries()) {
    if (value.count < 3) {
      continue;
    }

    const [presetName = "unknown", commandFamily = "unknown"] = key.split("::", 2);
    hints.push({
      id: `preset:${key}`,
      title: `Built-in preset fit: ${presetName}`,
      body: `Local history saw ${value.count} similar ${commandFamily} run(s) without the matching built-in preset. Use the preset directly so the first pass stays sharp and repeatable.`,
      command: suggestionCommandForPreset(presetName, value.commandFamily),
      evidenceCount: value.count
    });
  }

  for (const [key, value] of hookCandidateMap.entries()) {
    if (value.count < 5) {
      continue;
    }

    const [commandFamily] = key.split("::", 1);
    hints.push({
      id: `hook:${key}`,
      title: `Repeated explicit ${commandFamily} runs`,
      body: `Local history saw ${value.count} explicit ${commandFamily} run(s) through sift. If you want less typing, check the optional hook path before doing this by hand every time.`,
      command: `sift hook match -- ${commandFamily}`,
      evidenceCount: value.count
    });
  }

  return hints
    .sort((left, right) => right.evidenceCount - left.evidenceCount)
    .slice(0, 3);
}

export function renderGainReport(args: {
  summary: GainSummary;
  events: HistoryEvent[];
  days?: number;
  byPreset?: boolean;
}): string {
  if (args.events.length === 0) {
    return [
      "No local sift history yet.",
      "Run `sift exec` or `sift hook run` a few times, then come back to `sift gain`."
    ].join("\n");
  }

  const estimatedTokenDelta = args.summary.estimatedInputTokens - args.summary.estimatedOutputTokens;
  const estimatedCharDelta = args.summary.estimatedInputChars - args.summary.estimatedOutputChars;
  const sizeLine =
    estimatedTokenDelta > 0
      ? `- Estimated output reduction: ~${estimatedTokenDelta} tokens (${args.summary.estimatedInputChars} chars -> ${args.summary.estimatedOutputChars} chars)`
      : estimatedTokenDelta < 0
        ? `- Observed size change: ~${Math.abs(estimatedTokenDelta)} tokens larger (${args.summary.estimatedInputChars} chars -> ${args.summary.estimatedOutputChars} chars); mixed signal so far`
        : `- Observed size change: roughly neutral (${args.summary.estimatedInputChars} chars -> ${args.summary.estimatedOutputChars} chars)`
            + (estimatedCharDelta === 0 ? "" : `; char delta ${estimatedCharDelta > 0 ? "-" : "+"}${Math.abs(estimatedCharDelta)}`);

  const lines = [
    `Sift gain${args.days ? ` (last ${args.days}d)` : " (all local history)"}`,
    `- Recorded runs: ${args.summary.totalRuns}`,
    `- Meaningful runs: ${args.summary.meaningfulRuns}`,
    `- Low-signal runs: ${args.summary.lowSignalRuns}`,
    `- Reduced first passes: ${args.summary.reducedRuns}`,
    `- Provider skipped: ${args.summary.providerSkippedRuns}/${args.summary.totalRuns}`,
    sizeLine,
    `- Safety suppressions: ${args.summary.safetySuppressionRuns} run(s)`
  ];

  if (args.summary.totalDurationMs !== null && args.summary.measuredDurationRuns > 0) {
    const averageDurationMs = Math.round(args.summary.totalDurationMs / args.summary.measuredDurationRuns);
    lines.push(
      `- Observed runtime: ${args.summary.totalDurationMs}ms across ${args.summary.measuredDurationRuns} measured run(s) (avg ${averageDurationMs}ms)`
    );
  }

  if (args.summary.insufficientRuns > 0) {
    lines.push(`- Insufficient runs: ${args.summary.insufficientRuns}`);
  }

  if (args.summary.lowSignalRuns > 0) {
    lines.push(
      `- Confidence note: ${args.summary.lowSignalRuns} run(s) looked too small or too trivial for strategy-grade preset conclusions.`
    );
  }

  if (args.byPreset && args.summary.topPresets.length > 0) {
    lines.push("- Top presets:");
    for (const preset of args.summary.topPresets) {
      lines.push(
        `  ${preset.presetName}: ${preset.runs} run(s), ${preset.meaningfulRuns} meaningful, ${preset.lowSignalRuns} low-signal, ${describeConfidenceBucket(preset.confidenceBucket)}, ${formatPercent(preset.contaminationRate)} low-signal contamination, ${describeSignalDirection(preset.signalDirection)}, ~${preset.estimatedInputTokens - preset.estimatedOutputTokens} tokens smaller, provider skipped ${preset.providerSkippedRuns} time(s)`
      );
    }
  } else if (args.summary.topPresets.length > 0) {
    const top = args.summary.topPresets
      .map(
        (preset) =>
          `${preset.presetName} (${preset.runs}, ${describeConfidenceBucket(preset.confidenceBucket)}, ${preset.meaningfulRuns} meaningful)`
      )
      .join(", ");
    lines.push(`- Top presets: ${top}`);
  }

  lines.push(
    "- Notes: size/token savings above use meaningful runs only. Tiny or low-signal runs stay recorded locally but should not drive preset-level conclusions. Provider token counts are only exact when the provider reported them."
  );

  return lines.join("\n");
}

export function renderDiscoverReport(args: {
  events: HistoryEvent[];
  hints: DiscoverHint[];
  days?: number;
}): string {
  if (args.events.length < 5) {
    return [
      "Not enough local history yet for discover.",
      "Keep using sift a bit longer; this command stays quiet until the evidence is worth trusting."
    ].join("\n");
  }

  if (args.hints.length === 0) {
    return [
      `No strong discover hints${args.days ? ` in the last ${args.days}d` : ""}.`,
      "That is a good sign: local history is not showing a convincing missed-use pattern yet."
    ].join("\n");
  }

  const lines = [
    `Sift discover${args.days ? ` (last ${args.days}d)` : " (all local history)"}`
  ];

  for (const hint of args.hints) {
    lines.push(`- ${hint.title}`);
    lines.push(`  ${hint.body}`);
    lines.push(`  Try: ${hint.command}`);
  }

  lines.push(
    "Notes: discover only speaks when local history is thick enough and the repeated pattern is meaningful enough to trust. Suggestions are based on repeated observed patterns, not shell-wide telemetry."
  );

  return lines.join("\n");
}

export async function clearHistory(args: { homeDir?: string }): Promise<void> {
  await fs.rm(getDefaultHistoryEventsDir(args.homeDir ?? os.homedir()), {
    recursive: true,
    force: true
  });
}
