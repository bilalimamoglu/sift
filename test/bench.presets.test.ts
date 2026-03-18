import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./helpers/cli.js";

type CaseReport = {
  id: string;
  preset: string;
  docsSlug?: string;
  heuristicFired: boolean;
  reductionPct: number | null;
  snippetsMissing: string[];
  pass: boolean;
};

type BenchmarkReport = {
  tokenizer: string;
  cases: CaseReport[];
  aggregate: {
    totalCases: number;
    passed: number;
    heuristicFiredCount: number;
    totalRawTokens: number;
    totalReducedTokens: number;
    avgReductionPct: number | null;
  };
  byPreset: Array<{
    preset: string;
    caseCount: number;
    passed: number;
    heuristicFiredCount: number;
    totalRawTokens: number;
    totalReducedTokens: number;
    avgReductionPct: number | null;
  }>;
};

function runPresetBench(): BenchmarkReport {
  const scriptPath = path.join(repoRoot(), "scripts", "bench", "preset-reduction.ts");
  const result = spawnSync(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: repoRoot(),
    encoding: "utf8"
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as BenchmarkReport;
}

describe("preset reduction benchmark", () => {
  it("covers exactly the curated phase-2 case set", () => {
    const report = runPresetBench();

    expect(report.cases.map((candidate) => candidate.id)).toEqual([
      "ts-wall-mixed",
      "ts-module-not-found",
      "ts-single-file-errors",
      "eslint-mixed-rules",
      "eslint-single-file-dense",
      "eslint-warnings-only",
      "esbuild-missing-module",
      "webpack-type-error",
      "vite-syntax-error",
      "npm-audit-critical-only",
      "npm-audit-mixed-severity",
      "npm-audit-clean",
      "tf-plan-destroy",
      "tf-plan-safe-additions",
      "tf-plan-mixed-risk"
    ]);
  });

  it("marks every curated case as passing", () => {
    const report = runPresetBench();

    for (const candidate of report.cases) {
      expect(candidate.pass, `case ${candidate.id} should pass`).toBe(true);
      expect(candidate.snippetsMissing, `case ${candidate.id} missing snippets`).toEqual([]);
    }
  });

  it("shows positive token reduction for every heuristic-firing case", () => {
    const report = runPresetBench();

    for (const candidate of report.cases.filter((entry) => entry.heuristicFired)) {
      expect(candidate.reductionPct, `case ${candidate.id} should reduce tokens`).toBeGreaterThan(0);
    }
  });

  it("has positive aggregate reduction and one aggregate per curated preset", () => {
    const report = runPresetBench();

    expect(report.aggregate.totalReducedTokens).toBeLessThan(report.aggregate.totalRawTokens);
    expect(report.aggregate.avgReductionPct).toBeGreaterThan(0);
    expect(report.byPreset.map((candidate) => candidate.preset)).toEqual([
      "typecheck-summary",
      "lint-failures",
      "build-failure",
      "audit-critical",
      "infra-risk"
    ]);
    for (const candidate of report.byPreset) {
      expect(candidate.totalReducedTokens).toBeLessThan(candidate.totalRawTokens);
      expect(candidate.avgReductionPct, `preset ${candidate.preset} should reduce tokens`).toBeGreaterThan(0);
    }
  });

  it("keeps docs-linked examples attached to the benchmark corpus", () => {
    const report = runPresetBench();
    const docsCases = report.cases.filter((candidate) => candidate.docsSlug);

    expect(docsCases.map((candidate) => candidate.docsSlug)).toEqual([
      "01-tsc-type-wall",
      "02-eslint-stylish",
      "03-esbuild-build-failure",
      "04-npm-audit-critical",
      "05-terraform-destructive"
    ]);

    for (const candidate of docsCases) {
      const docPath = path.join(repoRoot(), "docs", "examples", `${candidate.docsSlug}.md`);
      expect(fs.existsSync(docPath), `${candidate.docsSlug} should exist`).toBe(true);
      const content = fs.readFileSync(docPath, "utf8");

      expect(content).toContain(`**Preset:** \`${candidate.preset}\``);
      expect(content).toContain(`**Case ID:** \`${candidate.id}\``);
      expect(content).toContain("## Impact");
    }
  });

  it("uses the o200k_base tokenizer", () => {
    const report = runPresetBench();

    expect(report.tokenizer).toBe("o200k_base");
  });
});
