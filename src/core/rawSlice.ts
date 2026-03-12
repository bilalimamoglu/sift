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
    const bucketTerms = unique(
      [bucket.root_cause, ...bucket.evidence]
        .map((value) => value.split(":").at(-1)?.trim() ?? value.trim())
        .filter((value) => value.length >= 4)
    );
    const indexes = lines
      .map((line, index) =>
        bucketTerms.some((term) => new RegExp(escapeRegExp(term), "i").test(line)) ? index : -1
      )
      .filter((index) => index >= 0);

    return unique([
      ...indexes.map((index) => lines[index]!).filter(Boolean),
      ...buildLineWindows({
        lines,
        indexes,
        radius: 2,
        maxLines: 16
      })
    ]);
  });

  const failureIndexes = lines
    .map((line, index) => (/\b(FAILED|ERROR)\b/.test(line) || /^E\s/.test(line) ? index : -1))
    .filter((index) => index >= 0);

  const selected = collapseSelectedLineGroups({
    groups: [
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
      buildLineWindows({
        lines,
        indexes: failureIndexes,
        radius: 1,
        maxLines: 24
      })
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
