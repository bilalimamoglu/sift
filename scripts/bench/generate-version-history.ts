import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

interface TestStatusFixtureReport {
  name: string;
  primary: {
    raw: { tokens: number };
    standard: { tokens: number };
    focused: { tokens: number };
    verbose: { tokens: number };
    diagnoseJson?: { tokens: number };
  };
}

interface TestStatusBenchmarkReport {
  fixtures: TestStatusFixtureReport[];
  aggregate: {
    primary: {
      raw: { tokens: number };
      standard: { tokens: number };
      focused: { tokens: number };
      verbose: { tokens: number };
      diagnoseJson?: { tokens: number };
    };
  };
}

interface PresetBenchmarkReport {
  aggregate: {
    totalCases: number;
    passed: number;
    avgReductionPct: number | null;
  };
}

interface VersionHistoryRow {
  tag: string;
  version: string;
  fixtureCount: number;
  presetBenchmarksAvailable: boolean;
  presetCaseCount: number | null;
  presetPassed: number | null;
  standardTokens: number;
  standardReductionPct: number;
  focusedTokens: number;
  verboseTokens: number;
  diagnoseJsonTokens: number | null;
}

interface CommonFixtureSnapshot {
  names: string[];
  byTag: Array<{
    tag: string;
    version: string;
    rawTokens: number;
    standardTokens: number;
    focusedTokens: number;
    verboseTokens: number;
    diagnoseJsonTokens: number | null;
    standardReductionPct: number;
  }>;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");

function parseArgs(argv: string[]): { since: string } {
  let since = "v0.3.0";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--since") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--since requires a tag, for example --since v0.3.0");
      }
      since = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { since };
}

function run(command: string, args: string[], cwd = repoRoot): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command} ${args.join(" ")}`);
  }

  return result.stdout;
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function getSortedTags(since: string): string[] {
  const tags = run("git", ["tag", "--sort=version:refname"]).trim().split("\n").filter(Boolean);
  const start = tags.indexOf(since);
  if (start === -1) {
    throw new Error(`Could not find tag ${since}`);
  }
  return tags.slice(start);
}

function loadJsonFromWorktree<T>(worktreePath: string, scriptPath: string, args: string[]): T {
  const stdout = run(process.execPath, ["--import", "tsx", scriptPath, ...args], worktreePath);
  return JSON.parse(stdout) as T;
}

function linkNodeModules(worktreePath: string): void {
  const target = path.join(repoRoot, "node_modules");
  const linkPath = path.join(worktreePath, "node_modules");
  symlinkSync(target, linkPath, "dir");
}

function pct(raw: number, reduced: number): number {
  if (raw === 0) {
    return 0;
  }
  return Number((((raw - reduced) / raw) * 100).toFixed(2));
}

function summarizeCommonFixtures(args: {
  rows: VersionHistoryRow[];
  reports: Array<{ tag: string; version: string; testStatus: TestStatusBenchmarkReport }>;
}): CommonFixtureSnapshot {
  const shared = args.reports
    .map((entry) => new Set(entry.testStatus.fixtures.map((fixture) => fixture.name)))
    .reduce((accumulator, candidate) => {
      return new Set([...accumulator].filter((name) => candidate.has(name)));
    });
  const names = [...shared].sort();

  return {
    names,
    byTag: args.reports.map((entry) => {
      const fixtures = entry.testStatus.fixtures.filter((fixture) => names.includes(fixture.name));
      const rawTokens = fixtures.reduce((sum, fixture) => sum + fixture.primary.raw.tokens, 0);
      const standardTokens = fixtures.reduce((sum, fixture) => sum + fixture.primary.standard.tokens, 0);
      const focusedTokens = fixtures.reduce((sum, fixture) => sum + fixture.primary.focused.tokens, 0);
      const verboseTokens = fixtures.reduce((sum, fixture) => sum + fixture.primary.verbose.tokens, 0);
      const diagnoseJsonTokens = fixtures.every((fixture) => fixture.primary.diagnoseJson)
        ? fixtures.reduce((sum, fixture) => sum + (fixture.primary.diagnoseJson?.tokens ?? 0), 0)
        : null;
      return {
        tag: entry.tag,
        version: entry.version,
        rawTokens,
        standardTokens,
        focusedTokens,
        verboseTokens,
        diagnoseJsonTokens,
        standardReductionPct: pct(rawTokens, standardTokens)
      };
    })
  };
}

function buildMarkdown(args: {
  since: string;
  rows: VersionHistoryRow[];
  common: CommonFixtureSnapshot;
}): string {
  const lines = [
    "# Version History Report",
    "",
    "This file is auto-generated by `scripts/bench/generate-version-history.ts`.",
    "",
    `- Since tag: \`${args.since}\``,
    `- Generated: \`${new Date().toISOString()}\``,
    "",
    "## As-Recorded Test-Status Aggregate",
    "",
    "These numbers are the exact aggregate benchmark outputs recorded at each tag. They are useful, but not perfectly apples-to-apples because the fixture corpus grew over time.",
    "",
    "| Tag | Version | Fixtures | Standard tokens | Standard reduction | Diagnose JSON | Preset cases |",
    "|-----|---------|----------|-----------------|--------------------|---------------|--------------|"
  ];

  for (const row of args.rows) {
    lines.push(
      `| ${row.tag} | ${row.version} | ${row.fixtureCount} | ${row.standardTokens} | ${row.standardReductionPct}% | ${row.diagnoseJsonTokens ?? "n/a"} | ${row.presetBenchmarksAvailable ? `${row.presetPassed}/${row.presetCaseCount}` : "n/a"} |`
    );
  }

  lines.push("", "## Common Fixture Baseline", "");
  lines.push(
    `Shared fixtures across all listed tags: ${args.common.names.map((name) => `\`${name}\``).join(", ")}`
  );
  lines.push("");
  lines.push("| Tag | Version | Raw tokens | Standard tokens | Standard reduction | Diagnose JSON |");
  lines.push("|-----|---------|------------|-----------------|--------------------|---------------|");

  for (const row of args.common.byTag) {
    lines.push(
      `| ${row.tag} | ${row.version} | ${row.rawTokens} | ${row.standardTokens} | ${row.standardReductionPct}% | ${row.diagnoseJsonTokens ?? "n/a"} |`
    );
  }

  lines.push("", "## Interpretation", "");
  lines.push("- `As-recorded` is the real benchmark state at that release.");
  lines.push("- `Common fixture baseline` is the fairer version-over-version comparison.");
  lines.push("- Diagnose JSON appears only once that surface existed in the tagged release.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tags = getSortedTags(args.since);
  const historyDir = path.join(repoRoot, "benchmarks", "history");
  ensureDir(historyDir);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "sift-version-history-"));
  const reports: Array<{
    tag: string;
    version: string;
    testStatus: TestStatusBenchmarkReport;
    preset?: PresetBenchmarkReport;
  }> = [];

  try {
    for (const tag of tags) {
      const worktreePath = path.join(tempRoot, tag);
      run("git", ["worktree", "add", "--detach", worktreePath, tag]);
      try {
        linkNodeModules(worktreePath);
        const version = (JSON.parse(readFileSync(path.join(worktreePath, "package.json"), "utf8")) as {
          version: string;
        }).version;
        const testStatus = loadJsonFromWorktree<TestStatusBenchmarkReport>(
          worktreePath,
          "scripts/bench/test-status-ab.ts",
          ["--json"]
        );
        const presetPath = path.join(worktreePath, "scripts", "bench", "preset-reduction.ts");
        let preset: PresetBenchmarkReport | undefined;
        try {
          readFileSync(presetPath, "utf8");
          preset = loadJsonFromWorktree<PresetBenchmarkReport>(worktreePath, "scripts/bench/preset-reduction.ts", []);
        } catch {
          preset = undefined;
        }
        reports.push({ tag, version, testStatus, preset });
      } finally {
        run("git", ["worktree", "remove", "--force", worktreePath]);
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const rows: VersionHistoryRow[] = reports.map((entry) => ({
    tag: entry.tag,
    version: entry.version,
    fixtureCount: entry.testStatus.fixtures.length,
    presetBenchmarksAvailable: Boolean(entry.preset),
    presetCaseCount: entry.preset?.aggregate.totalCases ?? null,
    presetPassed: entry.preset?.aggregate.passed ?? null,
    standardTokens: entry.testStatus.aggregate.primary.standard.tokens,
    standardReductionPct: pct(
      entry.testStatus.aggregate.primary.raw.tokens,
      entry.testStatus.aggregate.primary.standard.tokens
    ),
    focusedTokens: entry.testStatus.aggregate.primary.focused.tokens,
    verboseTokens: entry.testStatus.aggregate.primary.verbose.tokens,
    diagnoseJsonTokens: entry.testStatus.aggregate.primary.diagnoseJson?.tokens ?? null
  }));
  const common = summarizeCommonFixtures({ rows, reports });

  const jsonPayload = {
    since: args.since,
    generatedAt: new Date().toISOString(),
    rows,
    commonFixtureBaseline: common
  };

  writeFileSync(
    path.join(historyDir, "version-history.json"),
    `${JSON.stringify(jsonPayload, null, 2)}\n`
  );
  writeFileSync(
    path.join(historyDir, "version-history.md"),
    buildMarkdown({
      since: args.since,
      rows,
      common
    })
  );
}

await main();
