import type { TestRunner } from "./heuristics.js";

export interface TestStatusFamilySummary {
  prefix: string;
  count: number;
}

export interface TestStatusTargetSummary {
  count: number;
  families: TestStatusFamilySummary[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeTestId(value: string): string {
  return value.replace(/\\/g, "/").replace(/\s+/g, " ").trim();
}

function stripMatcherProse(value: string): string {
  return value.replace(/\s+-\s+.*$/, "").trim();
}

function extractJsFile(value: string): string | null {
  const match = value.match(/([A-Za-z0-9_./-]+\.(?:test|spec)\.[cm]?[jt]sx?)/i);
  return match ? normalizeTestId(match[1]!) : null;
}

export function normalizeFailingTarget(label: string, runner: TestRunner): string {
  const normalized = normalizeTestId(label).replace(/^['"]|['"]$/g, "");

  if (runner === "pytest") {
    return stripMatcherProse(normalized);
  }

  if (runner === "vitest" || runner === "jest") {
    const compact = normalized
      .replace(/^FAIL\s+/i, "")
      .replace(/^[❯×]\s*/, "")
      .replace(/\s+\[[^\]]+\]\s*$/, "")
      .trim();
    const file = extractJsFile(compact);
    if (!file) {
      return stripMatcherProse(compact);
    }

    const fileIndex = compact.indexOf(file);
    const suffix = compact.slice(fileIndex + file.length).trim();
    if (!suffix) {
      return file;
    }

    if (suffix.startsWith(">")) {
      const testName = stripMatcherProse(suffix.replace(/^>\s*/, ""));
      return testName.length > 0 ? `${file} > ${testName}` : file;
    }

    return file;
  }

  return normalized;
}

function extractFamilyPrefix(value: string): string {
  const normalized = normalizeTestId(value);
  const filePart = normalized.split("::")[0]?.split(" > ")[0]?.trim() ?? normalized;

  const workflowMatch = filePart.match(/^(\.github\/workflows\/)/);
  if (workflowMatch) {
    return workflowMatch[1]!;
  }

  const testsMatch = filePart.match(/^((?:test|tests)\/[^/]+\/)/);
  if (testsMatch) {
    return testsMatch[1]!;
  }

  const srcMatch = filePart.match(/^(src\/[^/]+\/)/);
  if (srcMatch) {
    return srcMatch[1]!;
  }

  const configMatch = filePart.match(
    /^((?:[^/]+\/)*(?:package\.json|pytest\.ini|pyproject\.toml|tox\.ini|conftest\.py|(?:vitest|jest)\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json|[^/]*config[^/]*\.(?:json|ya?ml)))$/i
  );
  if (configMatch) {
    return configMatch[1]!;
  }

  const segments = filePart.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}/`;
  }

  if (segments.length === 1) {
    return segments[0]!;
  }

  return "other";
}

export function buildTestTargetSummary(values: readonly string[]): TestStatusTargetSummary {
  const uniqueValues = unique(values);
  const counts = new Map<string, number>();

  for (const value of uniqueValues) {
    const prefix = extractFamilyPrefix(value);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  const families = [...counts.entries()]
    .map(([prefix, count]) => ({
      prefix,
      count
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.prefix.localeCompare(right.prefix);
    })
    .slice(0, 5);

  return {
    count: uniqueValues.length,
    families
  };
}

export function formatTargetSummary(summary: TestStatusTargetSummary): string {
  if (summary.count === 0) {
    return "count=0";
  }

  const families =
    summary.families.length > 0
      ? summary.families.map((family) => `${family.prefix}${family.count}`).join(", ")
      : "none";

  return `count=${summary.count}; families=${families}`;
}

function joinFamilies(families: readonly string[]): string {
  if (families.length === 0) {
    return "";
  }
  if (families.length === 1) {
    return families[0]!;
  }
  if (families.length === 2) {
    return `${families[0]} and ${families[1]}`;
  }

  return `${families.slice(0, -1).join(", ")}, and ${families.at(-1)}`;
}

export function describeTargetSummary(summary: TestStatusTargetSummary): string | null {
  if (summary.count === 0 || summary.families.length === 0) {
    return null;
  }

  const families = summary.families.map((family) => `${family.prefix} (${family.count})`);
  return `across ${joinFamilies(families)}`;
}
