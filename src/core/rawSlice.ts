import type { InputConfig, RawSliceStrategy } from "../types.js";
import type { TestStatusDiagnoseContract } from "./testStatusDecision.js";
import { truncateInput } from "./truncate.js";

export interface RawSliceResult {
  text: string;
  strategy: RawSliceStrategy;
  used: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

const genericBucketSearchTerms = new Set([
  "runtimeerror",
  "typeerror",
  "error",
  "exception",
  "failed",
  "failure",
  "visible failure",
  "failing tests",
  "setup failures",
  "runtime failure",
  "assertion failed",
  "network",
  "permission",
  "configuration"
]);

function normalizeSearchTerm(value: string): string {
  return value.replace(/^['"`]+|['"`]+$/g, "").trim();
}

function isHighSignalSearchTerm(term: string): boolean {
  const normalized = normalizeSearchTerm(term);
  if (normalized.length < 4) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (genericBucketSearchTerms.has(lower)) {
    return false;
  }

  if (/^(runtime|type|assertion|network|permission|configuration)\b/i.test(normalized)) {
    return false;
  }

  return true;
}

function scoreSearchTerm(term: string): number {
  const normalized = normalizeSearchTerm(term);
  let score = normalized.length;

  if (/^[A-Z][A-Z0-9_]{2,}$/.test(normalized)) {
    score += 80;
  }
  if (/^TS\d+$/.test(normalized)) {
    score += 70;
  }
  if (/^[45]\d\d\b/.test(normalized) || /\bHTTPError:\s*[45]\d\d\b/i.test(normalized)) {
    score += 60;
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    score += 50;
  }
  if (/\b[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b/.test(normalized)) {
    score += 40;
  }
  if (/['"`]/.test(term)) {
    score += 30;
  }
  if (normalized.includes("::")) {
    score += 25;
  }

  return score;
}

function collectCandidateSearchTerms(value: string): string[] {
  const candidates: string[] = [];
  const normalized = value.trim();
  if (!normalized) {
    return candidates;
  }

  for (const match of normalized.matchAll(/['"`]([^'"`]{4,})['"`]/g)) {
    candidates.push(match[1]!);
  }

  for (const match of normalized.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) {
    candidates.push(match[0]);
  }

  for (const match of normalized.matchAll(/\bTS\d+\b/g)) {
    candidates.push(match[0]);
  }

  for (const match of normalized.matchAll(/\bHTTPError:\s*[45]\d\d\b/gi)) {
    candidates.push(match[0]);
  }

  for (const match of normalized.matchAll(/\/[A-Za-z0-9_./:{}-]{4,}/g)) {
    candidates.push(match[0]);
  }

  for (const match of normalized.matchAll(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/g)) {
    candidates.push(match[0]);
  }

  for (const match of normalized.matchAll(/\b[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b/g)) {
    candidates.push(match[0]);
  }

  const detail = normalized.split(":").slice(1).join(":").trim();
  if (detail.length >= 8) {
    candidates.push(detail);
  }

  return candidates;
}

function extractBucketSearchTerms(args: {
  bucket: TestStatusDiagnoseContract["main_buckets"][number];
  readTargets: TestStatusDiagnoseContract["read_targets"];
}): string[] {
  const sources = [
    args.bucket.root_cause,
    ...args.bucket.evidence,
    ...args.readTargets
      .filter((target) => target.bucket_index === args.bucket.bucket_index)
      .flatMap((target) => [target.context_hint.search_hint ?? "", target.file])
  ];

  const prioritized = unique(
    sources.flatMap((value) => collectCandidateSearchTerms(value)).filter(isHighSignalSearchTerm)
  ).sort((left, right) => {
    const delta = scoreSearchTerm(right) - scoreSearchTerm(left);
    if (delta !== 0) {
      return delta;
    }
    return left.localeCompare(right);
  });

  if (prioritized.length > 0) {
    return prioritized.slice(0, 6);
  }

  const fallbackTerms = unique(
    [...args.bucket.evidence, args.bucket.root_cause]
      .flatMap((value) => value.split(/->|:/).map((part) => normalizeSearchTerm(part)))
      .filter(isHighSignalSearchTerm)
  );
  return fallbackTerms.slice(0, 4);
}

function clusterIndexes(indexes: number[], maxGap = 12): number[][] {
  if (indexes.length === 0) {
    return [];
  }

  const clusters: number[][] = [];
  let currentCluster = [indexes[0]!];

  for (const index of indexes.slice(1)) {
    if (index - currentCluster[currentCluster.length - 1]! <= maxGap) {
      currentCluster.push(index);
      continue;
    }

    clusters.push(currentCluster);
    currentCluster = [index];
  }

  clusters.push(currentCluster);
  return clusters;
}

function buildLineWindows(args: {
  lines: string[];
  indexes: number[];
  radius: number;
  maxLines: number;
}): string[] {
  const selected = new Set<number>();

  for (const index of args.indexes) {
    for (let cursor = Math.max(0, index - args.radius); cursor <= Math.min(args.lines.length - 1, index + args.radius); cursor += 1) {
      selected.add(cursor);
      if (selected.size >= args.maxLines) {
        break;
      }
    }
    if (selected.size >= args.maxLines) {
      break;
    }
  }

  return [...selected].sort((left, right) => left - right).map((index) => args.lines[index]!);
}

function buildPriorityLineGroup(args: {
  lines: string[];
  indexes: number[];
  radius: number;
  maxLines: number;
}): string[] {
  return unique([
    ...args.indexes.map((index) => args.lines[index]!).filter(Boolean),
    ...buildLineWindows(args)
  ]);
}

function collapseSelectedLines(args: {
  lines: string[];
  maxInputChars: number;
  fallback: () => string;
}): string {
  if (args.lines.length === 0) {
    return args.fallback();
  }

  const joined = unique(args.lines).join("\n").trim();
  if (joined.length === 0) {
    return args.fallback();
  }

  if (joined.length <= args.maxInputChars) {
    return joined;
  }

  return truncateInput(joined, {
    maxInputChars: args.maxInputChars,
    headChars: Math.min(Math.max(200, Math.floor(args.maxInputChars * 0.55)), args.maxInputChars),
    tailChars: Math.min(Math.max(120, Math.floor(args.maxInputChars * 0.2)), args.maxInputChars)
  }).text;
}

function collapseSelectedLineGroups(args: {
  groups: string[][];
  maxInputChars: number;
  fallback: () => string;
}): string {
  const selected: string[] = [];
  const seen = new Set<string>();
  const groups = args.groups.map((group) =>
    group.map((line) => line.trimEnd()).filter((line) => line.length > 0)
  );
  const cursors = groups.map(() => 0);

  let addedInPass = true;
  while (addedInPass) {
    addedInPass = false;

    for (const [groupIndex, group] of groups.entries()) {
      while (cursors[groupIndex]! < group.length) {
        const line = group[cursors[groupIndex]!]!;
        cursors[groupIndex] = cursors[groupIndex]! + 1;
        if (seen.has(line)) {
          continue;
        }

        const candidate = [...selected, line].join("\n");
        if (candidate.length > args.maxInputChars) {
          break;
        }

        selected.push(line);
        seen.add(line);
        addedInPass = true;
        break;
      }
    }
  }

  if (selected.length === 0) {
    return args.fallback();
  }

  return selected.join("\n");
}

function buildHeadTailFallback(input: string, config: InputConfig): RawSliceResult {
  const fallback = truncateInput(input, {
    maxInputChars: config.maxInputChars,
    headChars: config.headChars,
    tailChars: config.tailChars
  });

  return {
    text: fallback.text,
    strategy: "head_tail",
    used: fallback.truncatedApplied
  };
}

function findReadTargetIndexes(args: {
  lines: string[];
  file: string;
  line: number | null;
  contextHint: TestStatusDiagnoseContract["read_targets"][number]["context_hint"];
}): number[] {
  const escapedFile = escapeRegExp(args.file);
  const exactPatterns =
    args.line === null
      ? [new RegExp(escapedFile)]
      : [
          new RegExp(`${escapedFile}:${args.line}(?::\\d+)?`),
          new RegExp(`File\\s+"${escapedFile}",\\s+line\\s+${args.line}\\b`),
          new RegExp(`['"]${escapedFile}['"].*\\b${args.line}\\b`)
        ];

  const matches = args.lines
    .map((line, index) =>
      exactPatterns.some((pattern) => pattern.test(line)) ? index : -1
    )
    .filter((index) => index >= 0);

  if (matches.length > 0) {
    return matches;
  }

  if (args.contextHint.start_line !== null && args.contextHint.end_line !== null) {
    const startLine = args.contextHint.start_line;
    const endLine = args.contextHint.end_line;
    const rangeMatches = args.lines
      .map((line, index) => {
        const fileWithLine =
          line.match(/^([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?:\s+in\b/) ??
          line.match(/^([^:\s][^:]*\.[A-Za-z0-9]+):(\d+)(?::\d+)?:\s+in\b/) ??
          line.match(/^File\s+"([^"]+)",\s+line\s+(\d+)/);

        if (!fileWithLine || !fileWithLine[1] || !fileWithLine[2]) {
          return -1;
        }

        if (fileWithLine[1].replace(/\\/g, "/") !== args.file) {
          return -1;
        }

        const lineNumber = Number(fileWithLine[2]);
        return lineNumber >= startLine &&
          lineNumber <= endLine
          ? index
          : -1;
      })
      .filter((index) => index >= 0);

    if (rangeMatches.length > 0) {
      return rangeMatches;
    }
  }

  if (args.line !== null) {
    return [];
  }

  return args.lines
    .map((line, index) => (line.includes(args.file) ? index : -1))
    .filter((index) => index >= 0);
}

function findSearchHintIndexes(args: {
  lines: string[];
  searchHint: string | null;
}): number[] {
  if (!args.searchHint) {
    return [];
  }

  const pattern = new RegExp(escapeRegExp(args.searchHint), "i");
  return args.lines
    .map((line, index) => (pattern.test(line) ? index : -1))
    .filter((index) => index >= 0);
}

function buildTracebackSlice(args: { input: string; config: InputConfig }): RawSliceResult {
  const lines = args.input.split("\n");
  const indexes = lines
    .map((line, index) =>
      /(traceback|^E\s|error\b|failed\b|exception\b|assertionerror\b|runtimeerror\b)/i.test(line)
        ? index
        : -1
    )
    .filter((index) => index >= 0);

  if (indexes.length === 0) {
    return buildHeadTailFallback(args.input, args.config);
  }

  const text = collapseSelectedLines({
    lines: buildLineWindows({
      lines,
      indexes,
      radius: 3,
      maxLines: 80
    }),
    maxInputChars: args.config.maxInputChars,
    fallback: () =>
      truncateInput(args.input, {
        maxInputChars: args.config.maxInputChars,
        headChars: args.config.headChars,
        tailChars: args.config.tailChars
      }).text
  });

  return {
    text,
    strategy: "traceback_window",
    used: true
  };
}

export function buildTestStatusRawSlice(args: {
  input: string;
  config: InputConfig;
  contract: TestStatusDiagnoseContract;
}): RawSliceResult {
  if (args.input.length <= args.config.maxInputChars) {
    return {
      text: args.input,
      strategy: "none",
      used: false
    };
  }

  const lines = args.input.split("\n");
  const summaryIndexes = lines
    .map((line, index) =>
      /(=+.*(?:failed|errors?|passed|no tests ran|interrupted).*=+|\b\d+\s+failed\b|\b\d+\s+errors?\b)/i.test(
        line
      )
        ? index
        : -1
    )
    .filter((index) => index >= 0);

  const bucketGroups = args.contract.main_buckets.map((bucket) => {
    const bucketTerms = extractBucketSearchTerms({
      bucket,
      readTargets: args.contract.read_targets
    });
    const indexes = lines
      .map((line, index) =>
        bucketTerms.some((term) => new RegExp(escapeRegExp(term), "i").test(line)) ? index : -1
      )
      .filter((index) => index >= 0);

    return unique([
      ...indexes.map((index) => lines[index]!).filter(Boolean),
      ...buildPriorityLineGroup({
        lines,
        indexes,
        radius: 2,
        maxLines: 16
      })
    ]);
  });
  const targetGroups = args.contract.read_targets.flatMap((target) => {
    const searchHintIndexes = findSearchHintIndexes({
      lines,
      searchHint: target.context_hint.search_hint
    });
    const fileIndexes = findReadTargetIndexes({
      lines,
      file: target.file,
      line: target.line,
      contextHint: target.context_hint
    });
    const radius = target.line === null ? 1 : 2;
    const maxLines = target.line === null ? 6 : 8;
    const groups = [
      searchHintIndexes.length > 0
        ? buildPriorityLineGroup({
            lines,
            indexes: searchHintIndexes,
            radius,
            maxLines
          })
        : null,
      fileIndexes.length > 0
        ? buildPriorityLineGroup({
            lines,
            indexes: fileIndexes,
            radius,
            maxLines
          })
        : null
    ].filter((group): group is string[] => group !== null && group.length > 0);

    if (groups.length > 0) {
      return groups;
    }

    return [
      buildPriorityLineGroup({
        lines,
        indexes: unique([...searchHintIndexes, ...fileIndexes]),
        radius,
        maxLines
      })
    ];
  });

  const failureHeaderIndexes = lines
    .map((line, index) => (/\b(FAILED|ERROR)\b/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const failureIndexes = (failureHeaderIndexes.length > 0 ? failureHeaderIndexes : lines
    .map((line, index) => (/^E\s/.test(line) ? index : -1))
    .filter((index) => index >= 0))
    .filter((index) => index >= 0);
  const failureHeaderGroups = clusterIndexes(failureIndexes)
    .slice(0, 8)
    .map((cluster) =>
      buildPriorityLineGroup({
        lines,
        indexes: cluster,
        radius: 1,
        maxLines: 8
      })
    )
    .filter((group) => group.length > 0);

  const selected = collapseSelectedLineGroups({
    groups: [
      ...targetGroups,
      unique([
        ...summaryIndexes.map((index) => lines[index]!).filter(Boolean),
        ...buildLineWindows({
          lines,
          indexes: summaryIndexes,
          radius: 1,
          maxLines: 12
        })
      ]),
      ...bucketGroups,
      ...(failureHeaderGroups.length > 0
        ? failureHeaderGroups
        : [
            buildLineWindows({
              lines,
              indexes: failureIndexes,
              radius: 1,
              maxLines: 24
            })
          ])
    ],
    maxInputChars: args.config.maxInputChars,
    fallback: () =>
      truncateInput(args.input, {
        maxInputChars: args.config.maxInputChars,
        headChars: args.config.headChars,
        tailChars: args.config.tailChars
      }).text
  });

  if (selected.trim().length === 0) {
    return buildTracebackSlice({
      input: args.input,
      config: args.config
    });
  }

  return {
    text: selected,
    strategy: "bucket_evidence",
    used: true
  };
}

export function buildGenericRawSlice(args: {
  input: string;
  config: InputConfig;
}): RawSliceResult {
  if (args.input.length <= args.config.maxInputChars) {
    return {
      text: args.input,
      strategy: "none",
      used: false
    };
  }

  return buildTracebackSlice(args);
}
