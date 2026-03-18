import { getEncoding } from "js-tiktoken";
import {
  analyzeTestStatus,
  type FailureBucketType,
  type TestStatusAnalysis
} from "../../src/core/heuristics.js";
import {
  buildTestStatusDiagnoseContract,
  buildTestStatusPublicDiagnoseContract
} from "../../src/core/testStatusDecision.js";
import type { DetailLevel } from "../../src/types.js";
import {
  benchFixtures,
  type BenchFixture,
  type BenchCompletionExpectation
} from "../../test/fixtures/bench/test-status/fixtures.js";
import {
  buildLiveSessionFixtures,
  type LiveSessionFixture,
  type LiveStopDepth
} from "../../test/fixtures/bench/test-status/live-fixtures.js";
import { buildRealFixtures } from "../../test/fixtures/bench/test-status/real-fixtures.js";

type SiftMode = "standard" | "focused" | "verbose" | "verboseShowRaw";

interface OutputBudget {
  chars: number;
  tokens: number;
}

interface ReductionReport extends OutputBudget {
  charsSaved: number;
  charsPct: number;
  tokensSaved: number;
  tokensPct: number;
}

interface CompletionReport {
  complete: boolean;
  expectedBuckets: FailureBucketType[];
  bucketTypesFound: FailureBucketType[];
  missingBuckets: FailureBucketType[];
  expectedEntitiesAny: string[];
  matchedEntitiesAny: string[];
  entitiesFound: string[];
  expectedMaxDetail: DetailLevel;
  actualMaxDetail: DetailLevel | null;
}

interface RecipeReport extends OutputBudget {
  stepCount: number;
  stepsUsed: string[];
  complete: boolean;
  completionDepth: DetailLevel | null;
}

interface FixtureReport {
  name: string;
  description: string;
  decision: "stop" | "zoom" | "read_source" | "read_raw";
  primarySuspectKind: "test" | "app_code" | "config" | "environment" | "tooling" | "unknown";
  readTargetsCount: number;
  unknownBucketCount: number;
  completion: CompletionReport;
  primary: {
    raw: OutputBudget;
    standard: OutputBudget;
    focused: OutputBudget;
    verbose: OutputBudget;
    verboseShowRaw: OutputBudget;
    diagnoseJson: OutputBudget;
  };
  reductions: {
    standard: ReductionReport;
    focused: ReductionReport;
    verbose: ReductionReport;
    verboseShowRaw: ReductionReport;
    diagnoseJson: ReductionReport;
  };
  recipe: {
    siftFirst: RecipeReport;
    rawFirst: RecipeReport;
  };
  rendered?: {
    standardText: string;
    focusedText: string;
    verboseText: string;
    diagnoseJson: string;
  };
}

interface BenchmarkReport {
  tokenizer: string;
  fixtures: FixtureReport[];
  aggregate: {
    primary: {
      raw: OutputBudget;
      standard: OutputBudget;
      focused: OutputBudget;
      verbose: OutputBudget;
      verboseShowRaw: OutputBudget;
      diagnoseJson: OutputBudget;
    };
    recipe: {
      siftFirst: OutputBudget & {
        stepCount: number;
        completeCount: number;
      };
      rawFirst: OutputBudget & {
        stepCount: number;
      };
    };
  };
  liveSessions?: LiveSessionReport[];
  liveAggregate?: LiveAggregateReport;
}

interface LiveSessionFlowReport {
  totalTokens: number;
  consumedChars: number;
  externalToolCalls: number;
  internalToolUses: number;
  wallClockSeconds: number;
  providerInvocations: number | null;
  stopDepth: LiveStopDepth;
  diagnosisCorrect: boolean;
}

interface LiveSessionReport {
  name: string;
  description: string;
  rawFirst: LiveSessionFlowReport;
  siftFirst: LiveSessionFlowReport & {
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
  };
  delta: {
    tokensSaved: number;
    charsSaved: number;
    externalToolCallDelta: number;
    internalToolUseDelta: number;
    durationDeltaSeconds: number;
  };
  acceptance: {
    outputBudgetBetter: boolean;
    internalToolUsesImproved: boolean;
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
    stopBudgetSatisfied: boolean;
  };
}

interface LiveAggregateReport {
  rawFirst: LiveSessionFlowReport;
  siftFirst: LiveSessionFlowReport;
    comparisons: {
      sessions: number;
      outputBudgetBetterCount: number;
      internalToolUsesImprovedCount: number;
      standardSelfSufficientCount: number;
      firstSourceReadCoveredByReadTargetsCount: number;
      firstSourceReadNarrowedByContextHintCount: number;
      rawReverificationAvoidedCount: number;
      sourceReadsStayedTargetedCount: number;
      remainingIdsHiddenCount: number;
      heuristicCompletionCount: number;
      stopBudgetSatisfiedCount: number;
    };
  }

const INSUFFICIENT_SIGNAL = "Insufficient signal in the provided input.";
const DETAIL_ORDER: Record<DetailLevel, number> = {
  standard: 0,
  focused: 1,
  verbose: 2
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function measureOutput(text: string, encode: (value: string) => number): OutputBudget {
  return {
    chars: text.length,
    tokens: encode(text)
  };
}

function buildReduction(raw: OutputBudget, candidate: OutputBudget): ReductionReport {
  const charsSaved = raw.chars - candidate.chars;
  const tokensSaved = raw.tokens - candidate.tokens;
  return {
    ...candidate,
    charsSaved,
    charsPct: raw.chars === 0 ? 0 : Number(((charsSaved / raw.chars) * 100).toFixed(2)),
    tokensSaved,
    tokensPct: raw.tokens === 0 ? 0 : Number(((tokensSaved / raw.tokens) * 100).toFixed(2))
  };
}

function collectEntities(analysis: TestStatusAnalysis): string[] {
  return unique(analysis.buckets.flatMap((bucket) => bucket.entities)).filter(Boolean);
}

function inferBucketTypeFromContractBucket(bucket: {
  label: string;
  root_cause: string;
}): FailureBucketType | null {
  if (bucket.root_cause.startsWith("missing test env:") || bucket.label === "shared environment blocker") {
    return "shared_environment_blocker";
  }
  if (
    bucket.root_cause.includes("freeze snapshots are out of sync") ||
    ["route drift", "schema freeze mismatch", "model catalog drift", "stale snapshot"].includes(bucket.label)
  ) {
    return "contract_snapshot_drift";
  }
  if (bucket.root_cause.startsWith("snapshot mismatch:") || bucket.label === "snapshot mismatch") {
    return "snapshot_mismatch";
  }
  if (bucket.root_cause.startsWith("missing module:") || bucket.label === "import dependency failure") {
    return "import_dependency_failure";
  }
  if (bucket.root_cause.startsWith("configuration:") || bucket.label === "configuration error") {
    return "configuration_error";
  }
  if (bucket.root_cause.startsWith("timeout:") || bucket.label === "timeout") {
    return "timeout_failure";
  }
  if (bucket.root_cause.startsWith("permission:") || bucket.label === "permission denied") {
    return "permission_denied_failure";
  }
  if (bucket.root_cause.startsWith("network:") || bucket.label === "network failure") {
    return "network_failure";
  }
  if (bucket.root_cause.startsWith("assertion failed:") || bucket.label === "assertion failure") {
    return "assertion_failure";
  }
  if (bucket.label === "runtime failure" || /^[A-Z][A-Za-z]+(?:Error|Exception):/.test(bucket.root_cause)) {
    return "runtime_failure";
  }
  return null;
}

function buildCompletionReport(
  expectation: BenchCompletionExpectation,
  analysis: TestStatusAnalysis,
  contract: ReturnType<typeof buildTestStatusDiagnoseContract>["contract"]
): CompletionReport {
  const bucketTypesFound = unique([
    ...analysis.buckets.map((bucket) => bucket.type),
    ...contract.main_buckets
      .map((bucket) =>
        inferBucketTypeFromContractBucket({
          label: bucket.label,
          root_cause: bucket.root_cause
        })
      )
      .filter((bucketType): bucketType is FailureBucketType => bucketType !== null)
  ]);
  const missingBuckets = expectation.expectedBuckets.filter(
    (bucketType) => !bucketTypesFound.includes(bucketType)
  );
  const entitiesFound = collectEntities(analysis);
  const expectedEntitiesAny = expectation.expectedEntitiesAny ?? [];
  const matchedEntitiesAny = expectedEntitiesAny.filter((entity) => entitiesFound.includes(entity));
  const entitiesSatisfied = expectedEntitiesAny.length === 0 || matchedEntitiesAny.length > 0;
  const complete = missingBuckets.length === 0 && entitiesSatisfied;

  return {
    complete,
    expectedBuckets: expectation.expectedBuckets,
    bucketTypesFound,
    missingBuckets,
    expectedEntitiesAny,
    matchedEntitiesAny,
    entitiesFound,
    expectedMaxDetail: expectation.expectedMaxDetail,
    actualMaxDetail: complete ? "standard" : null
  };
}

function buildSiftRecipe(
  completion: CompletionReport,
  outputs: Record<SiftMode, string>,
  encode: (value: string) => number
): RecipeReport {
  const steps: { name: SiftMode; output: string }[] = [{ name: "standard", output: outputs.standard }];

  const chars = steps.reduce((total, step) => total + step.output.length, 0);
  const tokens = steps.reduce((total, step) => total + encode(step.output), 0);

  return {
    chars,
    tokens,
    stepCount: steps.length,
    stepsUsed: steps.map((step) => step.name),
    complete: completion.complete,
    completionDepth: completion.actualMaxDetail
  };
}

function buildRawRecipe(
  fixture: BenchFixture,
  encode: (value: string) => number
): RecipeReport {
  const steps = fixture.rawRecipe.slice(0, fixture.rawRecipeStopAfter);
  const chars = steps.reduce((total, step) => total + step.output.length, 0);
  const tokens = steps.reduce((total, step) => total + encode(step.output), 0);

  return {
    chars,
    tokens,
    stepCount: steps.length,
    stepsUsed: steps.map((step) => step.command),
    complete: steps.length === fixture.rawRecipeStopAfter,
    completionDepth: null
  };
}

function buildFixtureReport(
  fixture: BenchFixture,
  encode: (value: string) => number,
  options: {
    includeRendered: boolean;
  }
): FixtureReport {
  const analysis = analyzeTestStatus(fixture.rawOutput);
  const decision = buildTestStatusDiagnoseContract({
    input: fixture.rawOutput,
    analysis
  });
  const publicDiagnoseJson = JSON.stringify(
    buildTestStatusPublicDiagnoseContract({
      contract: decision.contract
    }),
    null,
    2
  );
  const outputs: Record<SiftMode, string> = {
    standard: decision.standardText,
    focused: decision.focusedText,
    verbose: decision.verboseText,
    verboseShowRaw: `${fixture.rawOutput}\n${decision.verboseText}`
  };
  const completion = buildCompletionReport(fixture.completion, analysis, decision.contract);
  const primary = {
    raw: measureOutput(fixture.rawOutput, encode),
    standard: measureOutput(outputs.standard, encode),
    focused: measureOutput(outputs.focused, encode),
    verbose: measureOutput(outputs.verbose, encode),
    verboseShowRaw: measureOutput(outputs.verboseShowRaw, encode),
    diagnoseJson: measureOutput(publicDiagnoseJson, encode)
  };

  return {
    name: fixture.name,
    description: fixture.description,
    decision: decision.contract.decision,
    primarySuspectKind: decision.contract.primary_suspect_kind,
    readTargetsCount: decision.contract.read_targets.length,
    unknownBucketCount: decision.contract.main_buckets.filter(
      (bucket) => bucket.suspect_kind === "unknown"
    ).length,
    completion,
    primary,
    reductions: {
      standard: buildReduction(primary.raw, primary.standard),
      focused: buildReduction(primary.raw, primary.focused),
      verbose: buildReduction(primary.raw, primary.verbose),
      verboseShowRaw: buildReduction(primary.raw, primary.verboseShowRaw),
      diagnoseJson: buildReduction(primary.raw, primary.diagnoseJson)
    },
    recipe: {
      siftFirst: buildSiftRecipe(completion, outputs, encode),
      rawFirst: buildRawRecipe(fixture, encode)
    },
    ...(options.includeRendered
      ? {
          rendered: {
            standardText: outputs.standard,
            focusedText: outputs.focused,
            verboseText: outputs.verbose,
            diagnoseJson: publicDiagnoseJson
          }
        }
      : {})
  };
}

function sumBudgets<T extends OutputBudget>(reports: T[]): OutputBudget {
  return reports.reduce(
    (total, report) => ({
      chars: total.chars + report.chars,
      tokens: total.tokens + report.tokens
    }),
    {
      chars: 0,
      tokens: 0
    }
  );
}

function buildAggregate(fixtures: FixtureReport[]): BenchmarkReport["aggregate"] {
  const primary = {
    raw: sumBudgets(fixtures.map((fixture) => fixture.primary.raw)),
    standard: sumBudgets(fixtures.map((fixture) => fixture.primary.standard)),
    focused: sumBudgets(fixtures.map((fixture) => fixture.primary.focused)),
    verbose: sumBudgets(fixtures.map((fixture) => fixture.primary.verbose)),
    verboseShowRaw: sumBudgets(fixtures.map((fixture) => fixture.primary.verboseShowRaw)),
    diagnoseJson: sumBudgets(fixtures.map((fixture) => fixture.primary.diagnoseJson))
  };

  return {
    primary,
    recipe: {
      siftFirst: {
        ...sumBudgets(fixtures.map((fixture) => fixture.recipe.siftFirst)),
        stepCount: fixtures.reduce((total, fixture) => total + fixture.recipe.siftFirst.stepCount, 0),
        completeCount: fixtures.filter((fixture) => fixture.recipe.siftFirst.complete).length
      },
      rawFirst: {
        ...sumBudgets(fixtures.map((fixture) => fixture.recipe.rawFirst)),
        stepCount: fixtures.reduce((total, fixture) => total + fixture.recipe.rawFirst.stepCount, 0)
      }
    }
  };
}

function sumNullable(values: Array<number | null>): number | null {
  const numericValues = values.filter((value): value is number => typeof value === "number");
  if (numericValues.length === 0) {
    return null;
  }

  return numericValues.reduce((total, value) => total + value, 0);
}

function buildLiveSessionReport(fixture: LiveSessionFixture): LiveSessionReport {
  return {
    name: fixture.name,
    description: fixture.description,
    rawFirst: fixture.rawFirst,
    siftFirst: fixture.siftFirst,
    delta: {
      tokensSaved: fixture.rawFirst.totalTokens - fixture.siftFirst.totalTokens,
      charsSaved: fixture.rawFirst.consumedChars - fixture.siftFirst.consumedChars,
      externalToolCallDelta:
        fixture.siftFirst.externalToolCalls - fixture.rawFirst.externalToolCalls,
      internalToolUseDelta: fixture.siftFirst.internalToolUses - fixture.rawFirst.internalToolUses,
      durationDeltaSeconds: fixture.siftFirst.wallClockSeconds - fixture.rawFirst.wallClockSeconds
    },
    acceptance: {
      outputBudgetBetter:
        fixture.rawFirst.totalTokens > fixture.siftFirst.totalTokens &&
        fixture.rawFirst.consumedChars > fixture.siftFirst.consumedChars,
      internalToolUsesImproved:
        fixture.siftFirst.internalToolUses < fixture.rawFirst.internalToolUses,
      standardSurfacedDominantBlocker: fixture.siftFirst.standardSurfacedDominantBlocker,
      standardSurfacedSecondaryBucket: fixture.siftFirst.standardSurfacedSecondaryBucket,
      standardSelfSufficientForVisibleBuckets:
        fixture.siftFirst.standardSelfSufficientForVisibleBuckets,
      sourceReadCount: fixture.siftFirst.sourceReadCount,
      firstSourceReadCoveredByReadTargets:
        fixture.siftFirst.firstSourceReadCoveredByReadTargets,
      firstSourceReadNarrowedByContextHint:
        fixture.siftFirst.firstSourceReadNarrowedByContextHint,
      rawReverificationAvoided: fixture.siftFirst.rawReverificationAvoided,
      sourceReadsStayedTargeted: fixture.siftFirst.sourceReadsStayedTargeted,
      sourceReadAfterZoomSteps: fixture.siftFirst.sourceReadAfterZoomSteps,
      remainingIdsExposedPublicly: fixture.siftFirst.remainingIdsExposedPublicly,
      diagnosisCompleteAtLayer: fixture.siftFirst.diagnosisCompleteAtLayer,
      stopBudgetSatisfied:
        fixture.siftFirst.sourceReadAfterZoomSteps !== null &&
        fixture.siftFirst.sourceReadAfterZoomSteps <= 1
    }
  };
}

function buildLiveAggregate(reports: LiveSessionReport[]): LiveAggregateReport {
  return {
    rawFirst: {
      totalTokens: reports.reduce((total, report) => total + report.rawFirst.totalTokens, 0),
      consumedChars: reports.reduce((total, report) => total + report.rawFirst.consumedChars, 0),
      externalToolCalls: reports.reduce(
        (total, report) => total + report.rawFirst.externalToolCalls,
        0
      ),
      internalToolUses: reports.reduce((total, report) => total + report.rawFirst.internalToolUses, 0),
      wallClockSeconds: reports.reduce((total, report) => total + report.rawFirst.wallClockSeconds, 0),
      providerInvocations: sumNullable(reports.map((report) => report.rawFirst.providerInvocations)),
      stopDepth: reports.at(-1)?.rawFirst.stopDepth ?? "raw",
      diagnosisCorrect: reports.every((report) => report.rawFirst.diagnosisCorrect)
    },
    siftFirst: {
      totalTokens: reports.reduce((total, report) => total + report.siftFirst.totalTokens, 0),
      consumedChars: reports.reduce((total, report) => total + report.siftFirst.consumedChars, 0),
      externalToolCalls: reports.reduce(
        (total, report) => total + report.siftFirst.externalToolCalls,
        0
      ),
      internalToolUses: reports.reduce((total, report) => total + report.siftFirst.internalToolUses, 0),
      wallClockSeconds: reports.reduce((total, report) => total + report.siftFirst.wallClockSeconds, 0),
      providerInvocations: sumNullable(reports.map((report) => report.siftFirst.providerInvocations)),
      stopDepth: reports.at(-1)?.siftFirst.stopDepth ?? "raw",
      diagnosisCorrect: reports.every((report) => report.siftFirst.diagnosisCorrect)
    },
    comparisons: {
      sessions: reports.length,
      outputBudgetBetterCount: reports.filter((report) => report.acceptance.outputBudgetBetter).length,
      internalToolUsesImprovedCount: reports.filter(
        (report) => report.acceptance.internalToolUsesImproved
      ).length,
      standardSelfSufficientCount: reports.filter(
        (report) => report.acceptance.standardSelfSufficientForVisibleBuckets
      ).length,
      firstSourceReadCoveredByReadTargetsCount: reports.filter(
        (report) => report.acceptance.firstSourceReadCoveredByReadTargets === true
      ).length,
      firstSourceReadNarrowedByContextHintCount: reports.filter(
        (report) => report.acceptance.firstSourceReadNarrowedByContextHint === true
      ).length,
      rawReverificationAvoidedCount: reports.filter(
        (report) => report.acceptance.rawReverificationAvoided
      ).length,
      sourceReadsStayedTargetedCount: reports.filter(
        (report) => report.acceptance.sourceReadsStayedTargeted
      ).length,
      remainingIdsHiddenCount: reports.filter(
        (report) => report.acceptance.remainingIdsExposedPublicly === false
      ).length,
      heuristicCompletionCount: reports.filter(
        (report) => report.acceptance.diagnosisCompleteAtLayer === "heuristic"
      ).length,
      stopBudgetSatisfiedCount: reports.filter((report) => report.acceptance.stopBudgetSatisfied).length
    }
  };
}

function formatBudget(label: string, budget: OutputBudget): string {
  return `${label}: ${budget.chars} chars / ${budget.tokens} tokens`;
}

function formatReduction(label: string, report: ReductionReport): string {
  return `${label}: ${report.tokensSaved} tokens saved (${report.tokensPct}% smaller than raw)`;
}

function formatCompletion(report: CompletionReport): string {
  const target = report.expectedMaxDetail;
  const actual = report.actualMaxDetail ?? "incomplete";
  return `completion target: ${target}; completed at: ${actual}`;
}

function formatBucketTypes(report: CompletionReport): string {
  return report.bucketTypesFound.length > 0
    ? `bucket types found: ${report.bucketTypesFound.join(", ")}`
    : "bucket types found: none";
}

function formatEntities(report: CompletionReport): string | null {
  if (report.expectedEntitiesAny.length === 0) {
    return null;
  }

  if (report.matchedEntitiesAny.length > 0) {
    return `matched entities: ${report.matchedEntitiesAny.join(", ")}`;
  }

  return `matched entities: none (expected any of ${report.expectedEntitiesAny.join(", ")})`;
}

function renderHumanReport(report: BenchmarkReport): string {
  const lines: string[] = [`Tokenizer: ${report.tokenizer}`, ""];

  for (const fixture of report.fixtures) {
    lines.push(`${fixture.name}`);
    lines.push(`  ${fixture.description}`);
    lines.push(`  ${formatCompletion(fixture.completion)}`);
    lines.push(`  ${formatBucketTypes(fixture.completion)}`);
    const entityLine = formatEntities(fixture.completion);
    if (entityLine) {
      lines.push(`  ${entityLine}`);
    }
    lines.push(`  ${formatBudget("raw", fixture.primary.raw)}`);
    lines.push(`  ${formatBudget("standard", fixture.primary.standard)}`);
    lines.push(`  ${formatBudget("focused", fixture.primary.focused)}`);
    lines.push(`  ${formatBudget("verbose", fixture.primary.verbose)}`);
    lines.push(`  ${formatBudget("verbose+show-raw", fixture.primary.verboseShowRaw)}`);
    lines.push(`  ${formatBudget("diagnose-json", fixture.primary.diagnoseJson)}`);
    lines.push(`  ${formatReduction("standard", fixture.reductions.standard)}`);
    lines.push(`  ${formatReduction("focused", fixture.reductions.focused)}`);
    lines.push(`  ${formatReduction("verbose", fixture.reductions.verbose)}`);
    lines.push(`  ${formatReduction("diagnose-json", fixture.reductions.diagnoseJson)}`);
    lines.push(
      `  sift-first recipe: ${fixture.recipe.siftFirst.stepCount} step(s), ${fixture.recipe.siftFirst.tokens} tokens, complete=${fixture.recipe.siftFirst.complete}, steps=${fixture.recipe.siftFirst.stepsUsed.join(" -> ")}`
    );
    lines.push(
      `  raw-first recipe: ${fixture.recipe.rawFirst.stepCount} step(s), ${fixture.recipe.rawFirst.tokens} tokens`
    );
    lines.push("");
  }

  lines.push("Aggregate");
  lines.push(`  ${formatBudget("raw", report.aggregate.primary.raw)}`);
  lines.push(`  ${formatBudget("standard", report.aggregate.primary.standard)}`);
  lines.push(`  ${formatBudget("focused", report.aggregate.primary.focused)}`);
  lines.push(`  ${formatBudget("verbose", report.aggregate.primary.verbose)}`);
  lines.push(`  ${formatBudget("verbose+show-raw", report.aggregate.primary.verboseShowRaw)}`);
  lines.push(`  ${formatBudget("diagnose-json", report.aggregate.primary.diagnoseJson)}`);
  lines.push(
    `  sift-first recipe: ${report.aggregate.recipe.siftFirst.stepCount} total steps, ${report.aggregate.recipe.siftFirst.tokens} tokens, completed fixtures=${report.aggregate.recipe.siftFirst.completeCount}/${report.fixtures.length}`
  );
  lines.push(
    `  raw-first recipe: ${report.aggregate.recipe.rawFirst.stepCount} total steps, ${report.aggregate.recipe.rawFirst.tokens} tokens`
  );

  if (report.liveSessions && report.liveSessions.length > 0) {
    lines.push("");
    lines.push("Live session scorecard");

    for (const session of report.liveSessions) {
      lines.push(`${session.name}`);
      lines.push(`  ${session.description}`);
      lines.push(
        `  raw-first: ${session.rawFirst.consumedChars} chars / ${session.rawFirst.totalTokens} tokens / ${session.rawFirst.externalToolCalls} external calls / ${session.rawFirst.internalToolUses} internal uses / ${session.rawFirst.wallClockSeconds}s / stop=${session.rawFirst.stopDepth}`
      );
      lines.push(
        `  sift-first: ${session.siftFirst.consumedChars} chars / ${session.siftFirst.totalTokens} tokens / ${session.siftFirst.externalToolCalls} external calls / ${session.siftFirst.internalToolUses} internal uses / ${session.siftFirst.wallClockSeconds}s / stop=${session.siftFirst.stopDepth}`
      );
      lines.push(
        `  delta: saved ${session.delta.charsSaved} chars and ${session.delta.tokensSaved} tokens; tool-call delta=${session.delta.externalToolCallDelta}; internal-use delta=${session.delta.internalToolUseDelta}; duration delta=${session.delta.durationDeltaSeconds}s`
      );
      lines.push(
        `  acceptance: outputBudgetBetter=${session.acceptance.outputBudgetBetter}, dominantBlockerVisibleAtStandard=${session.acceptance.standardSurfacedDominantBlocker}, secondaryBucketVisibleAtStandard=${session.acceptance.standardSurfacedSecondaryBucket}, stopBudgetSatisfied=${session.acceptance.stopBudgetSatisfied}`
      );
      lines.push(
        `  standard self-sufficient for visible buckets: ${session.acceptance.standardSelfSufficientForVisibleBuckets}`
      );
      if (session.acceptance.sourceReadCount !== null) {
        lines.push(`  source reads: ${session.acceptance.sourceReadCount}`);
      }
      if (session.acceptance.firstSourceReadCoveredByReadTargets !== null) {
        lines.push(
          `  first source read covered by read_targets: ${session.acceptance.firstSourceReadCoveredByReadTargets}`
        );
      }
      if (session.acceptance.firstSourceReadNarrowedByContextHint !== null) {
        lines.push(
          `  first source read narrowed by context_hint: ${session.acceptance.firstSourceReadNarrowedByContextHint}`
        );
      }
      lines.push(
        `  raw re-verification avoided: ${session.acceptance.rawReverificationAvoided}`
      );
      lines.push(
        `  source reads stayed targeted: ${session.acceptance.sourceReadsStayedTargeted}`
      );
      lines.push(
        `  remaining ids exposed publicly: ${session.acceptance.remainingIdsExposedPublicly}`
      );
      lines.push(
        `  diagnosis complete at layer: ${session.acceptance.diagnosisCompleteAtLayer}`
      );
      if (session.acceptance.sourceReadAfterZoomSteps !== null) {
        lines.push(
          `  source-read depth: after ${session.acceptance.sourceReadAfterZoomSteps} zoom step(s)`
        );
      }
      lines.push("");
    }

    if (report.liveAggregate) {
      lines.push("Live aggregate");
      lines.push(
        `  raw-first: ${report.liveAggregate.rawFirst.consumedChars} chars / ${report.liveAggregate.rawFirst.totalTokens} tokens`
      );
      lines.push(
        `  sift-first: ${report.liveAggregate.siftFirst.consumedChars} chars / ${report.liveAggregate.siftFirst.totalTokens} tokens`
      );
      lines.push(
        `  output-budget wins: ${report.liveAggregate.comparisons.outputBudgetBetterCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  internal-tool-use wins: ${report.liveAggregate.comparisons.internalToolUsesImprovedCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  self-sufficient standard wins: ${report.liveAggregate.comparisons.standardSelfSufficientCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  read-target-covered first source reads: ${report.liveAggregate.comparisons.firstSourceReadCoveredByReadTargetsCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  context-hint-narrowed first source reads: ${report.liveAggregate.comparisons.firstSourceReadNarrowedByContextHintCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  raw re-verification avoided: ${report.liveAggregate.comparisons.rawReverificationAvoidedCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  targeted-source-read wins: ${report.liveAggregate.comparisons.sourceReadsStayedTargetedCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  hidden remaining-id defaults: ${report.liveAggregate.comparisons.remainingIdsHiddenCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  heuristic completions: ${report.liveAggregate.comparisons.heuristicCompletionCount}/${report.liveAggregate.comparisons.sessions}`
      );
      lines.push(
        `  stop-budget wins: ${report.liveAggregate.comparisons.stopBudgetSatisfiedCount}/${report.liveAggregate.comparisons.sessions}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function main(): void {
  const asJson = process.argv.includes("--json");
  const includeReal = process.argv.includes("--real");
  const onlyReal = process.argv.includes("--only-real");
  const includeLive = process.argv.includes("--live");
  const onlyLive = process.argv.includes("--only-live");
  const includeRendered = process.argv.includes("--include-rendered");
  const encoding = getEncoding("o200k_base");
  const encode = (value: string) => encoding.encode(value).length;

  try {
    const syntheticFixtures = onlyReal || onlyLive ? [] : benchFixtures;
    const realFixtures = onlyLive ? [] : includeReal || onlyReal ? buildRealFixtures() : [];
    const liveFixtures = includeLive || onlyLive ? buildLiveSessionFixtures() : [];
    const allFixtures = [...syntheticFixtures, ...realFixtures];
    const fixtures = allFixtures.map((fixture) =>
      buildFixtureReport(fixture, encode, {
        includeRendered
      })
    );
    const liveSessions = liveFixtures.map((fixture) => buildLiveSessionReport(fixture));
    const report: BenchmarkReport = {
      tokenizer: "o200k_base",
      fixtures,
      aggregate: buildAggregate(fixtures),
      ...(liveSessions.length > 0
        ? {
            liveSessions,
            liveAggregate: buildLiveAggregate(liveSessions)
          }
        : {})
    };

    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    process.stdout.write(renderHumanReport(report));
  } finally {
    if ("free" in encoding && typeof encoding.free === "function") {
      encoding.free();
    }
  }
}

main();
