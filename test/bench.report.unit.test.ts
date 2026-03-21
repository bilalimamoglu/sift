import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers/cli.js";

describe("benchmark history report", () => {
  it("keeps the generated current benchmark report present and hygienic", () => {
    const root = repoRoot();
    const historyReadmePath = path.join(root, "benchmarks", "history", "README.md");
    const markdownPath = path.join(root, "benchmarks", "history", "current-benchmark-report.md");
    const jsonPath = path.join(root, "benchmarks", "history", "current-benchmark-report.json");

    expect(fs.existsSync(historyReadmePath)).toBe(true);
    expect(fs.existsSync(markdownPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);

    const historyReadme = fs.readFileSync(historyReadmePath, "utf8");
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const jsonText = fs.readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(jsonText) as {
      version: string;
      presetBenchmarks: { aggregate: { totalCases: number; passed: number } };
      testStatusBenchmarks: { fixtures: Array<{ name: string }> };
    };

    expect(historyReadme).not.toContain("/Users/");
    expect(markdown).not.toContain("/Users/");
    expect(jsonText).not.toContain("/Users/");

    expect(historyReadme).toContain("npm run bench:report");
    expect(markdown).toContain("# Current Benchmark Report");
    expect(markdown).toContain("## Preset Aggregate");
    expect(markdown).toContain("## Test-Status Aggregate");
    expect(parsed.version).toBe("0.4.1");
    expect(parsed.presetBenchmarks.aggregate.totalCases).toBe(16);
    expect(parsed.presetBenchmarks.aggregate.passed).toBe(16);
    expect(parsed.testStatusBenchmarks.fixtures.length).toBeGreaterThan(0);
  });
});
