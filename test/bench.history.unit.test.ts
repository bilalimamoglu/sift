import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "./helpers/cli.js";

describe("benchmark version history", () => {
  it("keeps a generated version history report for tagged releases", () => {
    const root = repoRoot();
    const readmePath = path.join(root, "benchmarks", "history", "README.md");
    const markdownPath = path.join(root, "benchmarks", "history", "version-history.md");
    const jsonPath = path.join(root, "benchmarks", "history", "version-history.json");

    expect(fs.existsSync(readmePath)).toBe(true);
    expect(fs.existsSync(markdownPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);

    const readme = fs.readFileSync(readmePath, "utf8");
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      since: string;
      rows: Array<{ tag: string; version: string; fixtureCount: number }>;
      commonFixtureBaseline: { names: string[] };
    };

    expect(readme).toContain("npm run bench:history");
    expect(readme).not.toContain("/Users/");
    expect(markdown).toContain("# Version History Report");
    expect(markdown).toContain("## Common Fixture Baseline");
    expect(markdown).not.toContain("/Users/");

    expect(json.since).toBe("v0.3.0");
    expect(json.rows.map((row) => row.tag)).toEqual(["v0.3.0", "v0.3.1", "v0.3.2", "v0.3.3"]);
    expect(json.rows.at(-1)?.version).toBe("0.3.3");
    expect(json.rows.at(-1)?.fixtureCount).toBe(11);
    expect(json.commonFixtureBaseline.names).toContain("mixed-full-suite");
  });
});
