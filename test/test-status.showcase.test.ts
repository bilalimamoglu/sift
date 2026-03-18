import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers/cli.js";
import { testStatusShowcaseCases } from "./fixtures/bench/test-status/showcase.js";

type Budget = { chars: number; tokens: number };
type FixtureReport = {
  name: string;
  primary: {
    raw: Budget;
    standard: Budget;
    diagnoseJson: Budget;
  };
  rendered?: {
    standardText: string;
    diagnoseJson: string;
  };
};
type BenchmarkReport = {
  fixtures: FixtureReport[];
};

function runBenchmark(): BenchmarkReport {
  const scriptPath = path.join(repoRoot(), "scripts", "bench", "test-status-ab.ts");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--json", "--real", "--include-rendered"],
    {
      cwd: repoRoot(),
      encoding: "utf8"
    }
  );

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as BenchmarkReport;
}

function reductionPct(rawTokens: number, reducedTokens: number): string {
  return `${(((rawTokens - reducedTokens) / rawTokens) * 100).toFixed(2)}%`;
}

describe("test-status showcase sync", () => {
  it("keeps showcase manifest and docs pages aligned to benchmark output", () => {
    const report = runBenchmark();
    expect(testStatusShowcaseCases.map((candidate) => candidate.docsSlug)).toEqual([
      "08-pytest-mixed-suite",
      "09-vitest-mixed-failures",
      "10-test-status-diagnose-json"
    ]);

    for (const showcaseCase of testStatusShowcaseCases) {
      const fixture = report.fixtures.find((candidate) => candidate.name === showcaseCase.fixtureName);
      expect(fixture).toBeDefined();

      const docsPath = path.join(repoRoot(), "docs", "examples", `${showcaseCase.docsSlug}.md`);
      expect(fs.existsSync(docsPath)).toBe(true);
      const markdown = fs.readFileSync(docsPath, "utf8");

      const rendered =
        showcaseCase.renderMode === "diagnose-json"
          ? fixture?.rendered?.diagnoseJson
          : fixture?.rendered?.standardText;
      const reducedBudget =
        showcaseCase.renderMode === "diagnose-json"
          ? fixture?.primary.diagnoseJson
          : fixture?.primary.standard;
      const codeFence = showcaseCase.renderMode === "diagnose-json" ? "json" : "text";

      expect(markdown).toContain("**Preset:** `test-status`");
      expect(markdown).toContain(`**Fixture:** \`${showcaseCase.fixtureName}\``);
      expect(markdown).toContain(`[${showcaseCase.rawPath}](../../${showcaseCase.rawPath})`);
      expect(markdown).toContain(`\`\`\`${codeFence}\n${rendered}\n\`\`\``);
      expect(markdown).toContain(`- Raw: \`${fixture?.primary.raw.chars}\` chars / \`${fixture?.primary.raw.tokens}\` tokens`);
      expect(markdown).toContain(
        `- Reduced: \`${reducedBudget?.chars}\` chars / \`${reducedBudget?.tokens}\` tokens`
      );
      expect(markdown).toContain(
        `- Reduction: \`${reductionPct(fixture?.primary.raw.tokens ?? 0, reducedBudget?.tokens ?? 0)}\``
      );
      expect(markdown).not.toContain("/Users/");
    }

    const diagnoseDocs = fs.readFileSync(
      path.join(repoRoot(), "docs", "examples", "10-test-status-diagnose-json.md"),
      "utf8"
    );
    expect(diagnoseDocs).not.toContain("resolved_tests");
    expect(diagnoseDocs).not.toContain("remaining_tests");
  });
});
