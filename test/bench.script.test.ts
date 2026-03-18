import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./helpers/cli.js";
import { testStatusPublicDiagnoseContractSchema } from "../src/core/testStatusDecision.js";

type Budget = { chars: number; tokens: number };
type PrimaryBudgets = {
  raw: Budget;
  standard: Budget;
  focused: Budget;
  verbose: Budget;
  verboseShowRaw: Budget;
  diagnoseJson: Budget;
};
type Completion = {
  complete: boolean;
  expectedBuckets: string[];
  bucketTypesFound: string[];
  expectedEntitiesAny: string[];
  matchedEntitiesAny: string[];
  entitiesFound: string[];
  expectedMaxDetail: "standard" | "focused" | "verbose";
  actualMaxDetail: "standard" | "focused" | "verbose" | null;
};
type FixtureReport = {
  name: string;
  decision: "stop" | "zoom" | "read_source" | "read_raw";
  primarySuspectKind: "test" | "app_code" | "config" | "environment" | "tooling" | "unknown";
  readTargetsCount: number;
  unknownBucketCount: number;
  primary: PrimaryBudgets;
  completion: Completion;
  recipe: {
    siftFirst: {
      stepCount: number;
      complete: boolean;
      completionDepth: "standard" | "focused" | "verbose" | null;
    };
    rawFirst: {
      stepCount: number;
      complete: boolean;
    };
  };
  rendered?: {
    standardText: string;
    focusedText: string;
    verboseText: string;
    diagnoseJson: string;
  };
};
type BenchmarkReport = {
  tokenizer: string;
  fixtures: FixtureReport[];
  aggregate: {
    primary: PrimaryBudgets;
    recipe: {
      siftFirst: { stepCount: number; chars: number; tokens: number; completeCount: number };
      rawFirst: { stepCount: number; chars: number; tokens: number };
    };
  };
  liveSessions?: Array<{
    name: string;
    delta: {
      tokensSaved: number;
      charsSaved: number;
      internalToolUseDelta: number;
    };
    acceptance: {
      outputBudgetBetter: boolean;
      standardSurfacedDominantBlocker: boolean;
      standardSurfacedSecondaryBucket: boolean;
      standardSelfSufficientForVisibleBuckets: boolean;
      sourceReadCount: number | null;
      firstSourceReadCoveredByReadTargets: boolean | null;
      firstSourceReadNarrowedByContextHint: boolean | null;
      rawReverificationAvoided: boolean;
      sourceReadsStayedTargeted: boolean;
      remainingIdsExposedPublicly: boolean;
      diagnosisCompleteAtLayer: "heuristic" | "provider" | "raw";
      stopBudgetSatisfied: boolean;
    };
  }>;
  liveAggregate?: {
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
  };
};

function runBenchmark(args: string[]): BenchmarkReport {
  const scriptPath = path.join(repoRoot(), "scripts", "bench", "test-status-ab.ts");
  const result = spawnSync(process.execPath, ["--import", "tsx", scriptPath, "--json", ...args], {
    cwd: repoRoot(),
    encoding: "utf8"
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as BenchmarkReport;
}

function assertBudgetInvariants(report: BenchmarkReport): void {
  expect(report.tokenizer).toBe("o200k_base");

  for (const fixture of report.fixtures) {
    expect(fixture.primary.raw.tokens).toBeGreaterThan(fixture.primary.standard.tokens);
    expect(fixture.primary.raw.tokens).toBeGreaterThan(fixture.primary.focused.tokens);
    expect(fixture.primary.raw.tokens).toBeGreaterThan(fixture.primary.verbose.tokens);
    expect(fixture.primary.verboseShowRaw.tokens).toBeGreaterThan(fixture.primary.verbose.tokens);
    expect(fixture.completion.complete).toBe(true);
    expect(fixture.recipe.siftFirst.complete).toBe(true);
    expect(fixture.recipe.rawFirst.complete).toBe(true);
    expect(fixture.completion.actualMaxDetail).toBe(fixture.completion.expectedMaxDetail);
    expect(fixture.recipe.siftFirst.completionDepth).toBe(fixture.completion.expectedMaxDetail);
    expect(fixture.recipe.siftFirst.stepCount).toBe(1);
  }

  expect(report.aggregate.primary.raw.tokens).toBeGreaterThan(report.aggregate.primary.standard.tokens);
  expect(report.aggregate.primary.raw.tokens).toBeGreaterThan(report.aggregate.primary.focused.tokens);
  expect(report.aggregate.primary.raw.tokens).toBeGreaterThan(report.aggregate.primary.verbose.tokens);
  expect(report.aggregate.recipe.rawFirst.tokens).toBeGreaterThan(report.aggregate.recipe.siftFirst.tokens);
  expect(report.aggregate.recipe.siftFirst.completeCount).toBe(report.fixtures.length);
}

function assertMixedFixtureHasBothBuckets(report: BenchmarkReport, name: string): void {
  const fixture = report.fixtures.find((candidate) => candidate.name === name);
  expect(fixture).toBeDefined();
  expect(fixture?.completion.bucketTypesFound).toEqual(
    expect.arrayContaining(["shared_environment_blocker", "contract_snapshot_drift"])
  );
  expect(fixture?.completion.entitiesFound).toEqual(
    expect.arrayContaining(["PGTEST_POSTGRES_DSN", "openai-gpt-image-1.5", "/api/v1/admin/landing-gallery"])
  );
}

describe("benchmark harness", () => {
  it("validates the synthetic fixture contract with structured completion", () => {
    const report = runBenchmark([]);

    expect(report.fixtures.map((fixture) => fixture.name)).toEqual([
      "single-blocker-short",
      "mixed-full-suite",
      "snapshot-drift-only",
      "missing-module-collection",
      "vitest-snapshot-mismatch",
      "vitest-mixed-js",
      "jest-mixed-js",
      "pytest-small-runtime-suite",
      "vitest-expect-assertions",
      "pytest-network-reset",
      "pytest-oserror-setup"
    ]);

    assertBudgetInvariants(report);
    assertMixedFixtureHasBothBuckets(report, "mixed-full-suite");
  });

  it("validates the real fixture contract with structured completion", () => {
    const report = runBenchmark(["--only-real"]);

    expect(report.fixtures.map((fixture) => fixture.name)).toEqual([
      "single-blocker-short-real",
      "mixed-full-suite-real",
      "snapshot-drift-only-real",
      "property-setter-setup-error-real"
    ]);

    assertBudgetInvariants(report);
    assertMixedFixtureHasBothBuckets(report, "mixed-full-suite-real");
  });

  it("supports combined synthetic and real runs", () => {
    const report = runBenchmark(["--real"]);

    expect(report.fixtures.map((fixture) => fixture.name)).toEqual([
      "single-blocker-short",
      "mixed-full-suite",
      "snapshot-drift-only",
      "missing-module-collection",
      "vitest-snapshot-mismatch",
      "vitest-mixed-js",
      "jest-mixed-js",
      "pytest-small-runtime-suite",
      "vitest-expect-assertions",
      "pytest-network-reset",
      "pytest-oserror-setup",
      "single-blocker-short-real",
      "mixed-full-suite-real",
      "snapshot-drift-only-real",
      "property-setter-setup-error-real"
    ]);

    assertBudgetInvariants(report);
    assertMixedFixtureHasBothBuckets(report, "mixed-full-suite");
    assertMixedFixtureHasBothBuckets(report, "mixed-full-suite-real");
  });

  it("can include rendered outputs and public diagnose metadata", () => {
    const report = runBenchmark(["--real", "--include-rendered"]);

    const mixedSuite = report.fixtures.find((fixture) => fixture.name === "mixed-full-suite-real");
    const vitestMixed = report.fixtures.find((fixture) => fixture.name === "vitest-mixed-js");

    expect(mixedSuite).toMatchObject({
      decision: "stop",
      primarySuspectKind: "environment",
      readTargetsCount: 2,
      unknownBucketCount: 0
    });
    expect(mixedSuite?.rendered?.standardText).toContain("Likely owner: environment setup");
    expect(mixedSuite?.rendered?.diagnoseJson).toContain('"primary_suspect_kind": "environment"');
    expect(mixedSuite?.rendered?.diagnoseJson).toContain('"confidence_reason":');
    expect(testStatusPublicDiagnoseContractSchema.parse(JSON.parse(mixedSuite?.rendered?.diagnoseJson ?? "{}")))
      .not.toHaveProperty("resolved_tests");
    expect(testStatusPublicDiagnoseContractSchema.parse(JSON.parse(mixedSuite?.rendered?.diagnoseJson ?? "{}")))
      .not.toHaveProperty("remaining_tests");

    expect(vitestMixed).toMatchObject({
      decision: "read_source",
      primarySuspectKind: "config",
      readTargetsCount: 3,
      unknownBucketCount: 0
    });
    expect(vitestMixed?.rendered?.standardText).toContain("Likely owner: test or project configuration");
    expect(vitestMixed?.primary.diagnoseJson.tokens).toBeGreaterThan(0);
  });

  it("reports live-session scorecards for captured agent transcripts", () => {
    const report = runBenchmark(["--live"]);

    expect(report.liveSessions).toHaveLength(1);
    expect(report.liveSessions?.[0]).toMatchObject({
      name: "mixed-full-suite-live",
      delta: {
        tokensSaved: 15633,
        charsSaved: 40000,
        internalToolUseDelta: -10
      },
      acceptance: {
        outputBudgetBetter: true,
        standardSurfacedDominantBlocker: true,
        standardSurfacedSecondaryBucket: true,
        standardSelfSufficientForVisibleBuckets: true,
        sourceReadCount: 3,
        firstSourceReadCoveredByReadTargets: true,
        firstSourceReadNarrowedByContextHint: null,
        rawReverificationAvoided: true,
        sourceReadsStayedTargeted: true,
        remainingIdsExposedPublicly: false,
        diagnosisCompleteAtLayer: "heuristic",
        stopBudgetSatisfied: true
      }
    });
    expect(report.liveAggregate).toMatchObject({
      comparisons: {
        sessions: 1,
        outputBudgetBetterCount: 1,
        internalToolUsesImprovedCount: 1,
        standardSelfSufficientCount: 1,
        firstSourceReadCoveredByReadTargetsCount: 1,
        firstSourceReadNarrowedByContextHintCount: 0,
        rawReverificationAvoidedCount: 1,
        sourceReadsStayedTargetedCount: 1,
        remainingIdsHiddenCount: 1,
        heuristicCompletionCount: 1,
        stopBudgetSatisfiedCount: 1
      }
    });
  });
});
