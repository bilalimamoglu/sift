import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyHeuristicPolicy } from "../src/core/heuristics.js";
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
});
