import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDefaultTestStatusStatePath } from "../constants.js";
import type { FailureBucketType, TestStatusAnalysis } from "./heuristics.js";
import type { DetailLevel } from "../types.js";

const detailSchema = z.enum(["standard", "focused", "verbose"]);
const failureBucketTypeSchema = z.enum([
  "shared_environment_blocker",
  "fixture_guard_failure",
  "service_unavailable",
  "db_connection_failure",
  "auth_bypass_absent",
  "contract_snapshot_drift",
  "import_dependency_failure",
  "collection_failure",
  "assertion_failure",
  "runtime_failure",
  "interrupted_run",
  "no_tests_collected",
  "unknown_failure"
]) satisfies z.ZodType<FailureBucketType>;

const countSchema = z.number().int().nonnegative();

const cachedBucketSchema = z.object({
  type: failureBucketTypeSchema,
  headline: z.string(),
  countVisible: countSchema,
  countClaimed: countSchema.optional(),
  reason: z.string(),
  entities: z.array(z.string())
});

const cachedAnalysisSchema = z.object({
  passed: countSchema,
  failed: countSchema,
  errors: countSchema,
  skipped: countSchema,
  noTestsCollected: z.boolean(),
  interrupted: z.boolean(),
  collectionErrorCount: countSchema.optional(),
  buckets: z.array(cachedBucketSchema)
});

const cachedCommandSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("argv"),
      argv: z.array(z.string()).min(1)
    }),
    z.object({
      mode: z.literal("shell"),
      shellCommand: z.string().min(1)
    })
  ])
  .optional();

const cachedPytestStateSchema = z
  .object({
    subsetCapable: z.boolean(),
    baseArgv: z.array(z.string()).min(1).optional(),
    failingNodeIds: z.array(z.string()),
    remainingNodeIds: z.array(z.string()).optional()
  })
  .optional();

const cachedRunSchema = z.object({
  version: z.literal(1),
  timestamp: z.string(),
  presetName: z.literal("test-status"),
  cwd: z.string(),
  commandKey: z.string(),
  commandPreview: z.string(),
  command: cachedCommandSchema,
  detail: detailSchema,
  exitCode: z.number().int(),
  rawOutput: z.string(),
  capture: z.object({
    originalChars: countSchema,
    truncatedApplied: z.boolean()
  }),
  analysis: cachedAnalysisSchema,
  pytest: cachedPytestStateSchema
});

export type CachedTestStatusBucket = z.infer<typeof cachedBucketSchema>;
export type CachedTestStatusAnalysis = z.infer<typeof cachedAnalysisSchema>;
export type CachedTestStatusCommand = NonNullable<z.infer<typeof cachedCommandSchema>>;
export type CachedPytestState = NonNullable<z.infer<typeof cachedPytestStateSchema>>;
export type CachedTestStatusRun = z.infer<typeof cachedRunSchema>;

export class MissingCachedTestStatusRunError extends Error {
  constructor() {
    super(
      "No cached test-status run found. Start with `sift exec --preset test-status -- <test command>`."
    );
  }
}

export class InvalidCachedTestStatusRunError extends Error {
  constructor() {
    super(
      "Cached test-status state is invalid. Run `sift exec --preset test-status -- <test command>` again."
    );
  }
}

function normalizeBucketReason(reason: string): string {
  return reason.trim().replace(/\s+/g, " ");
}

function getBucketCount(bucket: CachedTestStatusBucket): number {
  return bucket.countClaimed ?? bucket.countVisible;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function appendPreview(values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  const preview = values.slice(0, 2);
  const overflowCount = values.length - preview.length;
  const suffix = overflowCount > 0 ? `, and ${overflowCount} more` : "";
  return ` (${preview.join(", ")}${suffix})`;
}

function buildBucketSignature(bucket: CachedTestStatusBucket): string {
  return JSON.stringify([
    bucket.type,
    [...bucket.entities].sort(),
    normalizeBucketReason(bucket.reason)
  ]);
}

function basenameMatches(value: string, matcher: RegExp): boolean {
  return matcher.test(path.basename(value));
}

function isPytestExecutable(value: string): boolean {
  return basenameMatches(value, /^pytest(?:\.exe)?$/i);
}

function isPythonExecutable(value: string): boolean {
  return basenameMatches(value, /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i);
}

const shortPytestOptionsWithValue = new Set([
  "-c",
  "-k",
  "-m",
  "-n",
  "-o",
  "-p",
  "-W"
]);

const longPytestOptionsWithValue = new Set([
  "--asyncio-mode",
  "--basetemp",
  "--capture",
  "--color",
  "--confcutdir",
  "--cov",
  "--cov-config",
  "--cov-report",
  "--deselect",
  "--durations",
  "--durations-min",
  "--ignore",
  "--ignore-glob",
  "--import-mode",
  "--junitxml",
  "--log-cli-level",
  "--log-date-format",
  "--log-file",
  "--log-file-level",
  "--log-format",
  "--log-level",
  "--maxfail",
  "--override-ini",
  "--pyargs",
  "--rootdir",
  "--tb"
]);

function isSubsetCapablePytestArgv(argv: string[]): boolean {
  let offset = -1;

  if (argv.length > 0 && isPytestExecutable(argv[0]!)) {
    offset = 1;
  } else if (
    argv.length > 2 &&
    isPythonExecutable(argv[0]!) &&
    argv[1] === "-m" &&
    argv[2] === "pytest"
  ) {
    offset = 3;
  }

  if (offset === -1) {
    return false;
  }

  for (let index = offset; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (arg === "--") {
      return false;
    }

    if (!arg.startsWith("-")) {
      return false;
    }

    if (arg.startsWith("--")) {
      if (arg.includes("=")) {
        continue;
      }

      if (longPytestOptionsWithValue.has(arg)) {
        index += 1;
        if (index >= argv.length) {
          return false;
        }
      }

      continue;
    }

    const shortOption = arg.slice(0, 2);
    if (shortPytestOptionsWithValue.has(shortOption)) {
      if (arg.length === 2) {
        index += 1;
        if (index >= argv.length) {
          return false;
        }
      }
    }
  }

  return true;
}

function buildCachedCommand(args: {
  command?: string[];
  shellCommand?: string;
}): CachedTestStatusCommand | undefined {
  if (Array.isArray(args.command) && args.command.length > 0) {
    return {
      mode: "argv",
      argv: [...args.command]
    };
  }

  if (typeof args.shellCommand === "string" && args.shellCommand.length > 0) {
    return {
      mode: "shell",
      shellCommand: args.shellCommand
    };
  }

  return undefined;
}

function buildFailingNodeIds(analysis: TestStatusAnalysis): string[] {
  const values: string[] = [];

  for (const value of [...analysis.visibleErrorLabels, ...analysis.visibleFailedLabels]) {
    if (value.length > 0 && !values.includes(value)) {
      values.push(value);
    }
  }

  return values;
}

function buildCachedPytestState(args: {
  command?: CachedTestStatusCommand;
  analysis: TestStatusAnalysis;
  remainingNodeIds?: string[];
}): CachedPytestState {
  const baseArgv = args.command?.mode === "argv" && isSubsetCapablePytestArgv(args.command.argv)
    ? [...args.command.argv]
    : undefined;

  return {
    subsetCapable: Boolean(baseArgv),
    baseArgv,
    failingNodeIds: buildFailingNodeIds(args.analysis),
    remainingNodeIds: args.remainingNodeIds
  };
}

export function buildTestStatusCommandKey(args: {
  commandPreview: string;
  shellCommand?: string;
}): string {
  return `${args.shellCommand ? "shell" : "argv"}:${args.commandPreview}`;
}

export function snapshotTestStatusAnalysis(
  analysis: TestStatusAnalysis
): CachedTestStatusAnalysis {
  return {
    passed: analysis.passed,
    failed: analysis.failed,
    errors: analysis.errors,
    skipped: analysis.skipped,
    noTestsCollected: analysis.noTestsCollected,
    interrupted: analysis.interrupted,
    collectionErrorCount: analysis.collectionErrorCount,
    buckets: analysis.buckets.map((bucket) => ({
      type: bucket.type,
      headline: bucket.headline,
      countVisible: bucket.countVisible,
      countClaimed: bucket.countClaimed,
      reason: bucket.reason,
      entities: [...bucket.entities]
    }))
  };
}

export function createCachedTestStatusRun(args: {
  timestamp?: string;
  cwd: string;
  commandKey: string;
  commandPreview: string;
  command?: string[];
  shellCommand?: string;
  detail: DetailLevel;
  exitCode: number;
  rawOutput: string;
  originalChars: number;
  truncatedApplied: boolean;
  analysis: TestStatusAnalysis;
  remainingNodeIds?: string[];
}): CachedTestStatusRun {
  const command = buildCachedCommand({
    command: args.command,
    shellCommand: args.shellCommand
  });

  return {
    version: 1,
    timestamp: args.timestamp ?? new Date().toISOString(),
    presetName: "test-status",
    cwd: args.cwd,
    commandKey: args.commandKey,
    commandPreview: args.commandPreview,
    command,
    detail: args.detail,
    exitCode: args.exitCode,
    rawOutput: args.rawOutput,
    capture: {
      originalChars: args.originalChars,
      truncatedApplied: args.truncatedApplied
    },
    analysis: snapshotTestStatusAnalysis(args.analysis),
    pytest: buildCachedPytestState({
      command,
      analysis: args.analysis,
      remainingNodeIds: args.remainingNodeIds
    })
  };
}

export function readCachedTestStatusRun(
  statePath = getDefaultTestStatusStatePath()
): CachedTestStatusRun {
  let raw = "";

  try {
    raw = fs.readFileSync(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MissingCachedTestStatusRunError();
    }

    throw new InvalidCachedTestStatusRunError();
  }

  try {
    return cachedRunSchema.parse(JSON.parse(raw));
  } catch {
    throw new InvalidCachedTestStatusRunError();
  }
}

export function tryReadCachedTestStatusRun(
  statePath = getDefaultTestStatusStatePath()
): CachedTestStatusRun | null {
  try {
    return readCachedTestStatusRun(statePath);
  } catch {
    return null;
  }
}

export function writeCachedTestStatusRun(
  state: CachedTestStatusRun,
  statePath = getDefaultTestStatusStatePath()
): void {
  fs.mkdirSync(path.dirname(statePath), {
    recursive: true
  });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function getNextEscalationDetail(detail: DetailLevel): "focused" | "verbose" | null {
  if (detail === "standard") {
    return "focused";
  }

  if (detail === "focused") {
    return "verbose";
  }

  return null;
}

function buildTargetDelta(args: {
  previous: CachedTestStatusRun;
  current: CachedTestStatusRun;
}): {
  comparable: boolean;
  resolved: string[];
  remaining: string[];
  introduced: string[];
} {
  if (
    args.previous.presetName !== "test-status" ||
    args.current.presetName !== "test-status" ||
    args.previous.cwd !== args.current.cwd ||
    args.previous.commandKey !== args.current.commandKey
  ) {
    return {
      comparable: false,
      resolved: [],
      remaining: [],
      introduced: []
    };
  }

  if (!args.previous.pytest || !args.current.pytest) {
    return {
      comparable: false,
      resolved: [],
      remaining: [],
      introduced: []
    };
  }

  const previousTargets = args.previous.pytest.failingNodeIds;
  const currentTargets = args.current.pytest.failingNodeIds;
  const currentTargetSet = new Set(currentTargets);
  const previousTargetSet = new Set(previousTargets);

  return {
    comparable: true,
    resolved: previousTargets.filter((target) => !currentTargetSet.has(target)),
    remaining: currentTargets.filter((target) => previousTargetSet.has(target)),
    introduced: currentTargets.filter((target) => !previousTargetSet.has(target))
  };
}

export function diffTestStatusTargets(args: {
  previous: CachedTestStatusRun;
  current: CachedTestStatusRun;
}): {
  comparable: boolean;
  resolved: string[];
  remaining: string[];
  introduced: string[];
} {
  return buildTargetDelta(args);
}

export function getRemainingPytestNodeIds(state: CachedTestStatusRun): string[] {
  return state.pytest?.remainingNodeIds ?? state.pytest?.failingNodeIds ?? [];
}

export interface CachedTestStatusDelta {
  lines: string[];
  remainingNodeIds?: string[];
}

export function diffTestStatusRuns(args: {
  previous: CachedTestStatusRun;
  current: CachedTestStatusRun;
}): CachedTestStatusDelta {
  const targetDelta = buildTargetDelta(args);
  const previousBuckets = new Map(
    args.previous.analysis.buckets.map((bucket) => [buildBucketSignature(bucket), bucket] as const)
  );
  const currentBuckets = new Map(
    args.current.analysis.buckets.map((bucket) => [buildBucketSignature(bucket), bucket] as const)
  );
  const lines: string[] = [];

  if (targetDelta.resolved.length > 0) {
    lines.push(
      `- Resolved: ${formatCount(targetDelta.resolved.length, "failing test/module", "failing tests/modules")} no longer appear${appendPreview(targetDelta.resolved)}.`
    );
  }

  if (targetDelta.remaining.length > 0) {
    lines.push(
      `- Remaining: ${formatCount(targetDelta.remaining.length, "failing test/module", "failing tests/modules")} still appear${appendPreview(targetDelta.remaining)}.`
    );
  }

  if (targetDelta.introduced.length > 0) {
    lines.push(
      `- New: ${formatCount(targetDelta.introduced.length, "failing test/module", "failing tests/modules")} appeared${appendPreview(targetDelta.introduced)}.`
    );
  }

  for (const bucket of args.current.analysis.buckets) {
    const signature = buildBucketSignature(bucket);
    const previous = previousBuckets.get(signature);
    if (!previous) {
      continue;
    }

    const previousCount = getBucketCount(previous);
    const currentCount = getBucketCount(bucket);
    if (previousCount !== currentCount) {
      lines.push(`- Changed: ${bucket.headline} (${previousCount} -> ${currentCount}).`);
    }
  }

  if (lines.length === 0) {
    for (const bucket of args.previous.analysis.buckets) {
      const signature = buildBucketSignature(bucket);
      if (!currentBuckets.has(signature)) {
        lines.push(`- Resolved: ${bucket.headline} (${getBucketCount(bucket)}).`);
      }
    }

    for (const bucket of args.current.analysis.buckets) {
      const signature = buildBucketSignature(bucket);
      if (!previousBuckets.has(signature)) {
        lines.push(`- New: ${bucket.headline} (${getBucketCount(bucket)}).`);
      }
    }
  }

  return {
    lines: lines.slice(0, 4),
    remainingNodeIds: targetDelta.comparable ? targetDelta.remaining : undefined
  };
}

export function renderTestStatusDelta(args: {
  previous: CachedTestStatusRun;
  current: CachedTestStatusRun;
}): string[] {
  return diffTestStatusRuns(args).lines;
}

export function getCachedRerunCommand(state: CachedTestStatusRun):
  | { command: string[]; shellCommand?: never }
  | { command?: never; shellCommand: string } {
  if (state.command?.mode === "argv") {
    return {
      command: [...state.command.argv]
    };
  }

  if (state.command?.mode === "shell") {
    return {
      shellCommand: state.command.shellCommand
    };
  }

  throw new Error(
    "Cached test-status run cannot be rerun because the original command was not stored. Run `sift exec --preset test-status -- <test command>` again."
  );
}

export function getRemainingPytestRerunCommand(state: CachedTestStatusRun): string[] {
  if (!state.pytest?.subsetCapable || !state.pytest.baseArgv) {
    throw new Error(
      "Cached test-status run cannot use `sift rerun --remaining`. Automatic remaining-subset reruns currently support only argv-mode `pytest ...` or `python -m pytest ...` commands. Run a narrowed command manually with `sift exec --preset test-status -- <narrowed pytest command>`."
    );
  }

  const remainingNodeIds = getRemainingPytestNodeIds(state);
  return [...state.pytest.baseArgv, ...remainingNodeIds];
}
