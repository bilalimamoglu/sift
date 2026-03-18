import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTestStatus, applyHeuristicPolicy } from "../src/core/heuristics.js";
import {
  buildTestStatusDiagnoseContract,
  buildTestStatusPublicDiagnoseContract
} from "../src/core/testStatusDecision.js";
import { repoRoot } from "./helpers/cli.js";

const buildFailurePairs = [
  "esbuild-missing-module-full",
  "webpack-build-failure-full",
  "vite-import-analysis-full",
  "vite-build-failure-full"
];

describe("examples companion sync", () => {
  it("build-failure reduced outputs match current heuristic", () => {
    for (const name of buildFailurePairs) {
      const rawPath = path.join(repoRoot(), "examples", "build-failure", `${name}.raw.txt`);
      const reducedPath = path.join(repoRoot(), "examples", "build-failure", `${name}.reduced.txt`);
      const raw = fs.readFileSync(rawPath, "utf8");
      const committed = fs.readFileSync(reducedPath, "utf8").trim();
      const actual = applyHeuristicPolicy("build-failure", raw);
      expect(actual, `${name} reduced output must match committed file`).toBe(committed);
    }
  });

  it("test-status rendered companions match current public output", () => {
    const root = repoRoot();
    const mixedRaw = fs.readFileSync(
      path.join(root, "test", "fixtures", "bench", "test-status", "real", "mixed-full-suite.txt"),
      "utf8"
    );
    const vitestRaw = fs.readFileSync(
      path.join(root, "test", "fixtures", "bench", "test-status", "synthetic", "vitest-mixed-js.txt"),
      "utf8"
    );

    const mixedStandardCommitted = fs.readFileSync(
      path.join(root, "examples", "test-status", "mixed-full-suite-real.standard.txt"),
      "utf8"
    ).trim();
    const mixedDiagnoseCommitted = fs.readFileSync(
      path.join(root, "examples", "test-status", "mixed-full-suite-real.diagnose.json"),
      "utf8"
    ).trim();
    const vitestStandardCommitted = fs.readFileSync(
      path.join(root, "examples", "test-status", "vitest-mixed-js.standard.txt"),
      "utf8"
    ).trim();

    const mixedStandardActual = applyHeuristicPolicy("test-status", mixedRaw);
    const mixedDecision = buildTestStatusDiagnoseContract({
      input: mixedRaw,
      analysis: analyzeTestStatus(mixedRaw)
    });
    const mixedDiagnoseActual = JSON.stringify(
      buildTestStatusPublicDiagnoseContract({
        contract: mixedDecision.contract
      }),
      null,
      2
    );
    const vitestStandardActual = applyHeuristicPolicy("test-status", vitestRaw);

    expect(mixedStandardActual).toBe(mixedStandardCommitted);
    expect(mixedDiagnoseActual).toBe(mixedDiagnoseCommitted);
    expect(vitestStandardActual).toBe(vitestStandardCommitted);
  });
});
