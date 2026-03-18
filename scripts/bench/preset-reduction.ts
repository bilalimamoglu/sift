import { readFileSync } from "node:fs";
import { getEncoding } from "js-tiktoken";
import {
  benchmarkCases,
  resolveCaseRawPath,
  type BenchmarkCase,
  type BenchmarkPreset,
  type ExpectedReductionKind,
  type SourceType
} from "../../benchmarks/catalog.js";
import { applyHeuristicPolicy } from "../../src/core/heuristics.js";

interface CaseReport {
  id: string;
  preset: BenchmarkPreset;
  title: string;
  docsSlug?: string;
  sourceType: SourceType;
  expectedReductionKind: ExpectedReductionKind;
  rawChars: number;
  rawTokens: number;
  reducedOutput: string | null;
  reducedChars: number | null;
  reducedTokens: number | null;
  charsSaved: number | null;
  tokensSaved: number | null;
  reductionPct: number | null;
  heuristicFired: boolean;
  snippetsFound: string[];
  snippetsMissing: string[];
  pass: boolean;
}

interface PresetAggregate {
  preset: BenchmarkPreset;
  caseCount: number;
  passed: number;
  heuristicFiredCount: number;
  totalRawTokens: number;
  totalReducedTokens: number;
  avgReductionPct: number | null;
}

interface BenchmarkReport {
  tokenizer: "o200k_base";
  cases: CaseReport[];
  aggregate: {
    totalCases: number;
    passed: number;
    heuristicFiredCount: number;
    totalRawTokens: number;
    totalReducedTokens: number;
    avgReductionPct: number | null;
  };
  byPreset: PresetAggregate[];
}

function parseArgs(argv: string[]): { preset?: BenchmarkPreset; id?: string } {
  let preset: BenchmarkPreset | undefined;
  let id: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      continue;
    }
    if (arg === "--preset") {
      const value = argv[index + 1];
      if (
        value !== "typecheck-summary" &&
        value !== "lint-failures" &&
        value !== "build-failure" &&
        value !== "audit-critical" &&
        value !== "infra-risk"
      ) {
        throw new Error(
          "--preset must be one of: typecheck-summary, lint-failures, build-failure, audit-critical, infra-risk."
        );
      }
      preset = value;
      index += 1;
      continue;
    }
    if (arg === "--id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--id requires a case id.");
      }
      id = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { preset, id };
}

const encoding = getEncoding("o200k_base");

function countTokens(text: string): number {
  return encoding.encode(text).length;
}

function averageReduction(reports: Array<{ reductionPct: number | null }>): number | null {
  const present = reports
    .map((report) => report.reductionPct)
    .filter((value): value is number => value !== null);

  if (present.length === 0) {
    return null;
  }

  return Number((present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(2));
}

function buildCaseReport(caseDef: BenchmarkCase): CaseReport {
  const raw = readFileSync(resolveCaseRawPath(caseDef.relativeRawPath), "utf8");
  const rawChars = raw.length;
  const rawTokens = countTokens(raw);
  const reducedOutput = applyHeuristicPolicy(caseDef.preset, raw);
  const heuristicFired = reducedOutput !== null;
  const reducedChars = reducedOutput?.length ?? null;
  const reducedTokens = reducedOutput ? countTokens(reducedOutput) : null;
  const charsSaved = reducedChars === null ? null : rawChars - reducedChars;
  const tokensSaved = reducedTokens === null ? null : rawTokens - reducedTokens;
  const reductionPct =
    reducedTokens === null || rawTokens === 0
      ? null
      : Number((((rawTokens - reducedTokens) / rawTokens) * 100).toFixed(2));

  const snippetsFound: string[] = [];
  const snippetsMissing: string[] = [];

  for (const snippet of caseDef.expectedSnippets) {
    if (reducedOutput?.includes(snippet)) {
      snippetsFound.push(snippet);
    } else {
      snippetsMissing.push(snippet);
    }
  }

  return {
    id: caseDef.id,
    preset: caseDef.preset,
    title: caseDef.title,
    docsSlug: caseDef.docsSlug,
    sourceType: caseDef.sourceType,
    expectedReductionKind: caseDef.expectedReductionKind,
    rawChars,
    rawTokens,
    reducedOutput,
    reducedChars,
    reducedTokens,
    charsSaved,
    tokensSaved,
    reductionPct,
    heuristicFired,
    snippetsFound,
    snippetsMissing,
    pass:
      heuristicFired === caseDef.expectedHeuristicFires && snippetsMissing.length === 0
  };
}

function buildPresetAggregate(
  preset: BenchmarkPreset,
  reports: CaseReport[]
): PresetAggregate {
  const subset = reports.filter((report) => report.preset === preset);
  const reducedSubset = subset.filter(
    (report): report is CaseReport & { reducedTokens: number } => report.reducedTokens !== null
  );

  return {
    preset,
    caseCount: subset.length,
    passed: subset.filter((report) => report.pass).length,
    heuristicFiredCount: subset.filter((report) => report.heuristicFired).length,
    totalRawTokens: subset.reduce((sum, report) => sum + report.rawTokens, 0),
    totalReducedTokens: reducedSubset.reduce((sum, report) => sum + report.reducedTokens, 0),
    avgReductionPct: averageReduction(subset)
  };
}

const args = parseArgs(process.argv.slice(2));
const selectedCases = benchmarkCases.filter((caseDef) => {
  if (args.preset && caseDef.preset !== args.preset) {
    return false;
  }
  if (args.id && caseDef.id !== args.id) {
    return false;
  }
  return true;
});

const caseReports = selectedCases.map(buildCaseReport);
const reducedReports = caseReports.filter(
  (report): report is CaseReport & { reducedTokens: number } => report.reducedTokens !== null
);
const presentPresets = [
  ...new Set(caseReports.map((report) => report.preset))
] as BenchmarkPreset[];

const report: BenchmarkReport = {
  tokenizer: "o200k_base",
  cases: caseReports,
  aggregate: {
    totalCases: caseReports.length,
    passed: caseReports.filter((candidate) => candidate.pass).length,
    heuristicFiredCount: caseReports.filter((candidate) => candidate.heuristicFired).length,
    totalRawTokens: caseReports.reduce((sum, candidate) => sum + candidate.rawTokens, 0),
    totalReducedTokens: reducedReports.reduce((sum, candidate) => sum + candidate.reducedTokens, 0),
    avgReductionPct: averageReduction(caseReports)
  },
  byPreset: presentPresets.map((preset) => buildPresetAggregate(preset, caseReports))
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
