import { getEncoding } from "js-tiktoken";
import {
  analyzeTestStatus,
  applyHeuristicPolicy,
  type FailureBucketType,
  type TestStatusAnalysis
} from "../../src/core/heuristics.js";
import type { DetailLevel } from "../../src/types.js";
import {
  benchFixtures,
  type BenchFixture,
  type BenchCompletionExpectation
} from "../../test/fixtures/bench/test-status/fixtures.js";
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
  completion: CompletionReport;
  primary: {
    raw: OutputBudget;
    standard: OutputBudget;
    focused: OutputBudget;
    verbose: OutputBudget;
    verboseShowRaw: OutputBudget;
  };
  reductions: {
    standard: ReductionReport;
    focused: ReductionReport;
    verbose: ReductionReport;
    verboseShowRaw: ReductionReport;
  };
  recipe: {
    siftFirst: RecipeReport;
    rawFirst: RecipeReport;
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

function renderSiftOutput(fixture: BenchFixture, mode: SiftMode): string {
  const detail: DetailLevel =
    mode === "standard" ? "standard" : mode === "focused" ? "focused" : "verbose";
  const heuristic = applyHeuristicPolicy("test-status", fixture.rawOutput, detail) ?? INSUFFICIENT_SIGNAL;

  if (mode === "verboseShowRaw") {
    return `${fixture.rawOutput}\n${heuristic}`;
  }

  return heuristic;
}

function collectEntities(analysis: TestStatusAnalysis): string[] {
  return unique(analysis.buckets.flatMap((bucket) => bucket.entities)).filter(Boolean);
}

function buildCompletionReport(
  expectation: BenchCompletionExpectation,
  analysis: TestStatusAnalysis
): CompletionReport {
  const bucketTypesFound = unique(analysis.buckets.map((bucket) => bucket.type));
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
  encode: (value: string) => number
): FixtureReport {
  const analysis = analyzeTestStatus(fixture.rawOutput);
  const outputs: Record<SiftMode, string> = {
    standard: renderSiftOutput(fixture, "standard"),
    focused: renderSiftOutput(fixture, "focused"),
    verbose: renderSiftOutput(fixture, "verbose"),
    verboseShowRaw: renderSiftOutput(fixture, "verboseShowRaw")
  };
  const completion = buildCompletionReport(fixture.completion, analysis);
  const primary = {
    raw: measureOutput(fixture.rawOutput, encode),
    standard: measureOutput(outputs.standard, encode),
    focused: measureOutput(outputs.focused, encode),
    verbose: measureOutput(outputs.verbose, encode),
    verboseShowRaw: measureOutput(outputs.verboseShowRaw, encode)
  };

  return {
    name: fixture.name,
    description: fixture.description,
    completion,
    primary,
    reductions: {
      standard: buildReduction(primary.raw, primary.standard),
      focused: buildReduction(primary.raw, primary.focused),
      verbose: buildReduction(primary.raw, primary.verbose),
      verboseShowRaw: buildReduction(primary.raw, primary.verboseShowRaw)
    },
    recipe: {
      siftFirst: buildSiftRecipe(completion, outputs, encode),
      rawFirst: buildRawRecipe(fixture, encode)
    }
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
    verboseShowRaw: sumBudgets(fixtures.map((fixture) => fixture.primary.verboseShowRaw))
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
    lines.push(`  ${formatReduction("standard", fixture.reductions.standard)}`);
    lines.push(`  ${formatReduction("focused", fixture.reductions.focused)}`);
    lines.push(`  ${formatReduction("verbose", fixture.reductions.verbose)}`);
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
  lines.push(
    `  sift-first recipe: ${report.aggregate.recipe.siftFirst.stepCount} total steps, ${report.aggregate.recipe.siftFirst.tokens} tokens, completed fixtures=${report.aggregate.recipe.siftFirst.completeCount}/${report.fixtures.length}`
  );
  lines.push(
    `  raw-first recipe: ${report.aggregate.recipe.rawFirst.stepCount} total steps, ${report.aggregate.recipe.rawFirst.tokens} tokens`
  );

  return `${lines.join("\n")}\n`;
}

function main(): void {
  const asJson = process.argv.includes("--json");
  const includeReal = process.argv.includes("--real");
  const onlyReal = process.argv.includes("--only-real");
  const encoding = getEncoding("o200k_base");
  const encode = (value: string) => encoding.encode(value).length;

  try {
    const syntheticFixtures = onlyReal ? [] : benchFixtures;
    const realFixtures = includeReal || onlyReal ? buildRealFixtures() : [];
    const allFixtures = [...syntheticFixtures, ...realFixtures];
    const fixtures = allFixtures.map((fixture) => buildFixtureReport(fixture, encode));
    const report: BenchmarkReport = {
      tokenizer: "o200k_base",
      fixtures,
      aggregate: buildAggregate(fixtures)
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
