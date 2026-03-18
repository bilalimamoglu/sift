import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDefaultTestStatusStatePath } from "../constants.js";
import {
  detectTestRunner,
  type FailureBucketType,
  type TestRunner,
  type TestStatusAnalysis
} from "./heuristics.js";
import type { DetailLevel } from "../types.js";
import {
  buildTestTargetSummary,
  describeTargetSummary,
  normalizeFailingTarget
} from "./testStatusTargets.js";

const detailSchema = z.enum(["standard", "focused", "verbose"]);
const failureBucketTypeSchema = z.enum([
  "shared_environment_blocker",
  "fixture_guard_failure",
  "timeout_failure",
  "permission_denied_failure",
  "async_event_loop_failure",
  "fixture_teardown_failure",
  "db_migration_failure",
  "configuration_error",
  "xdist_worker_crash",
  "type_error_failure",
  "resource_leak_warning",
  "django_db_access_denied",
  "network_failure",
  "subprocess_crash_segfault",
  "flaky_test_detected",
  "serialization_encoding_failure",
  "file_not_found_failure",
  "memory_error",
  "deprecation_warning_as_error",
  "xfail_strict_unexpected_pass",
  "service_unavailable",
  "db_connection_failure",
  "auth_bypass_absent",
  "contract_snapshot_drift",
  "snapshot_mismatch",
  "import_dependency_failure",
  "collection_failure",
  "assertion_failure",
  "golden_output_drift",
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

const testRunnerSchema = z.enum(["pytest", "vitest", "jest", "unknown"]) satisfies z.ZodType<TestRunner>;

const cachedRunnerSubsetSchema = z.object({
  available: z.boolean(),
  strategy: z.enum(["pytest-node-ids", "none"]),
  baseArgv: z.array(z.string()).min(1).optional()
});

const cachedRunnerStateSchema = z.object({
  name: testRunnerSchema,
  failingTargets: z.array(z.string()),
  baselineCommand: cachedCommandSchema,
  subset: cachedRunnerSubsetSchema
});

const cachedRunV1Schema = z.object({
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

const cachedRunV2Schema = z.object({
  version: z.literal(2),
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
  runner: cachedRunnerStateSchema
});

const cachedRunSchema = z.discriminatedUnion("version", [cachedRunV1Schema, cachedRunV2Schema]);

export type CachedTestStatusBucket = z.infer<typeof cachedBucketSchema>;
export type CachedTestStatusAnalysis = z.infer<typeof cachedAnalysisSchema>;
export type CachedTestStatusCommand = NonNullable<z.infer<typeof cachedCommandSchema>>;
export type CachedPytestState = NonNullable<z.infer<typeof cachedPytestStateSchema>>;
export type CachedRunnerState = z.infer<typeof cachedRunnerStateSchema>;
type CachedTestStatusRunV1 = z.infer<typeof cachedRunV1Schema>;
type CachedTestStatusRunV2 = z.infer<typeof cachedRunV2Schema>;
export type CachedTestStatusRun = CachedTestStatusRunV2 & {
  runnerMigrationFallbackUsed?: boolean;
};

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

function detectRunnerFromCommand(command?: CachedTestStatusCommand): TestRunner {
  if (!command) {
    return "unknown";
  }

  if (command.mode === "argv") {
    const [first, second, third] = command.argv;
    if (first && isPytestExecutable(first)) {
      return "pytest";
    }
    if (first && isPythonExecutable(first) && second === "-m" && third === "pytest") {
      return "pytest";
    }
    if (first && basenameMatches(first, /^vitest(?:\.exe)?$/i)) {
      return "vitest";
    }
    if (first && basenameMatches(first, /^jest(?:\.exe)?$/i)) {
      return "jest";
    }
    return "unknown";
  }

  if (/\bpython(?:\d+(?:\.\d+)*)?\s+-m\s+pytest\b|\bpytest\b/i.test(command.shellCommand)) {
    return "pytest";
  }
  if (/\bvitest\b/i.test(command.shellCommand)) {
    return "vitest";
  }
  if (/\bjest\b/i.test(command.shellCommand)) {
    return "jest";
  }

  return "unknown";
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

function buildFailingTargets(analysis: TestStatusAnalysis): string[] {
  const runner = analysis.runner;
  const values: string[] = [];

  for (const value of [...analysis.visibleErrorLabels, ...analysis.visibleFailedLabels]) {
    const normalized = normalizeFailingTarget(value, runner);
    if (normalized.length > 0 && !values.includes(normalized)) {
      values.push(normalized);
    }
  }

  return values;
}

function buildCachedRunnerState(args: {
  command?: CachedTestStatusCommand;
  analysis: TestStatusAnalysis;
}): CachedRunnerState {
  const baseArgv = args.command?.mode === "argv" && isSubsetCapablePytestArgv(args.command.argv)
    ? [...args.command.argv]
    : undefined;
  const runnerName =
    args.analysis.runner !== "unknown" ? args.analysis.runner : detectRunnerFromCommand(args.command);

  return {
    name: runnerName,
    failingTargets: buildFailingTargets(args.analysis),
    baselineCommand: args.command,
    subset: {
      available: runnerName === "pytest" && Boolean(baseArgv),
      strategy: runnerName === "pytest" && baseArgv ? "pytest-node-ids" : "none",
      ...(runnerName === "pytest" && baseArgv ? { baseArgv } : {})
    }
  };
}

function normalizeCwd(value: string): string {
  return path.resolve(value).replace(/\\/g, "/");
}

export function buildTestStatusBaselineIdentity(args: {
  cwd: string;
  runner: TestRunner;
  command?: CachedTestStatusCommand;
  commandPreview?: string;
  shellCommand?: string;
}): string {
  const cwd = normalizeCwd(args.cwd);
  const command =
    args.command ??
    buildCachedCommand({
      shellCommand: args.shellCommand,
      command: args.shellCommand ? undefined : args.commandPreview?.split(" ")
    });
  const mode = command?.mode ?? (args.shellCommand ? "shell" : "argv");
  const normalizedCommand =
    command?.mode === "argv"
      ? command.argv.join("\u001f")
      : command?.mode === "shell"
        ? command.shellCommand.trim().replace(/\s+/g, " ")
        : (args.commandPreview ?? "").trim().replace(/\s+/g, " ");

  return [cwd, args.runner, mode, normalizedCommand].join("\u001e");
}

export function buildTestStatusCommandKey(args: {
  cwd?: string;
  runner?: TestRunner;
  command?: CachedTestStatusCommand;
  commandPreview: string;
  shellCommand?: string;
}): string {
  return buildTestStatusBaselineIdentity({
    cwd: args.cwd ?? process.cwd(),
    runner: args.runner ?? "unknown",
    command: args.command,
    commandPreview: args.commandPreview,
    shellCommand: args.shellCommand
  });
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
  commandKey?: string;
  commandPreview?: string;
  command?: string[];
  shellCommand?: string;
  detail: DetailLevel;
  exitCode: number;
  rawOutput: string;
  originalChars: number;
  truncatedApplied: boolean;
  analysis: TestStatusAnalysis;
}): CachedTestStatusRun {
  const command = buildCachedCommand({
    command: args.command,
    shellCommand: args.shellCommand
  });
  const runnerName =
    args.analysis.runner !== "unknown" ? args.analysis.runner : detectRunnerFromCommand(command);
  const commandPreview =
    args.commandPreview ?? args.shellCommand ?? (args.command ?? []).join(" ");
  const commandKey =
    args.commandKey ??
    buildTestStatusBaselineIdentity({
      cwd: args.cwd,
      runner: runnerName,
      command,
      commandPreview,
      shellCommand: args.shellCommand
    });

  return {
    version: 2,
    timestamp: args.timestamp ?? new Date().toISOString(),
    presetName: "test-status",
    cwd: args.cwd,
    commandKey,
    commandPreview,
    command,
    detail: args.detail,
    exitCode: args.exitCode,
    rawOutput: args.rawOutput,
    capture: {
      originalChars: args.originalChars,
      truncatedApplied: args.truncatedApplied
    },
    analysis: snapshotTestStatusAnalysis(args.analysis),
    runner: buildCachedRunnerState({
      command,
      analysis: args.analysis
    })
  };
}

function migrateCachedTestStatusRun(
  state: CachedTestStatusRunV1 | CachedTestStatusRunV2
): CachedTestStatusRun {
  if (state.version === 2) {
    return state;
  }

  const runnerFromOutput = detectTestRunner(state.rawOutput);
  const runner = runnerFromOutput !== "unknown" ? runnerFromOutput : detectRunnerFromCommand(state.command);
  const storedCommand = state.command;
  const fallbackBaseArgv = !storedCommand && state.pytest?.baseArgv
    ? {
        mode: "argv" as const,
        argv: [...state.pytest.baseArgv]
      }
    : undefined;
  const baselineCommand = storedCommand ?? fallbackBaseArgv;
  const commandPreview =
    state.commandPreview ??
    (baselineCommand?.mode === "argv"
      ? baselineCommand.argv.join(" ")
      : baselineCommand?.mode === "shell"
        ? baselineCommand.shellCommand
        : "");
  const commandKey = buildTestStatusBaselineIdentity({
    cwd: state.cwd,
    runner,
    command: baselineCommand,
    commandPreview
  });

  return {
    version: 2,
    timestamp: state.timestamp,
    presetName: state.presetName,
    cwd: state.cwd,
    commandKey,
    commandPreview,
    command: state.command,
    detail: state.detail,
    exitCode: state.exitCode,
    rawOutput: state.rawOutput,
    capture: state.capture,
    analysis: state.analysis,
    runner: {
      name: runner,
      failingTargets: [...new Set((state.pytest?.failingNodeIds ?? []).map((target) =>
        normalizeFailingTarget(target, runner)
      ))],
      baselineCommand,
      subset: {
        available: runner === "pytest" && Boolean(state.pytest?.baseArgv),
        strategy:
          runner === "pytest" && state.pytest?.baseArgv ? "pytest-node-ids" : "none",
        ...(runner === "pytest" && state.pytest?.baseArgv
          ? {
              baseArgv: [...state.pytest.baseArgv]
            }
          : {})
      }
    },
    ...(fallbackBaseArgv ? { runnerMigrationFallbackUsed: true } : {})
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
    return migrateCachedTestStatusRun(cachedRunSchema.parse(JSON.parse(raw)));
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
    args.previous.commandKey !== args.current.commandKey ||
    args.previous.runner.name !== args.current.runner.name ||
    args.previous.runner.name === "unknown"
  ) {
    return {
      comparable: false,
      resolved: [],
      remaining: [],
      introduced: []
    };
  }

  const previousTargets = args.previous.runner.failingTargets;
  const currentTargets = args.current.runner.failingTargets;
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

export function isRemainingSubsetAvailable(state: CachedTestStatusRun): boolean {
  return state.runner.name === "pytest" && state.runner.subset.available;
}

export function getRemainingPytestNodeIds(state: CachedTestStatusRun): string[] {
  return state.runner.name === "pytest" ? state.runner.failingTargets : [];
}

export interface CachedTestStatusDelta {
  lines: string[];
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
  const resolvedSummary = buildTestTargetSummary(targetDelta.resolved);
  const remainingSummary = buildTestTargetSummary(targetDelta.remaining);
  const introducedSummary = buildTestTargetSummary(targetDelta.introduced);

  const pushTargetLine = (args: {
    kind: "Resolved" | "Remaining" | "New";
    summary: ReturnType<typeof buildTestTargetSummary>;
    countLabel: string;
    fallbackValues: string[];
    verb: string;
  }) => {
    if (args.summary.count === 0) {
      return;
    }

    const summaryText = describeTargetSummary(args.summary);
    if (summaryText) {
      lines.push(
        `- ${args.kind}: ${formatCount(args.summary.count, args.countLabel, `${args.countLabel}s`)} ${args.verb} ${summaryText}.`
      );
      return;
    }

    lines.push(
      `- ${args.kind}: ${formatCount(args.summary.count, args.countLabel, `${args.countLabel}s`)} ${args.verb}${appendPreview(args.fallbackValues)}.`
    );
  };

  pushTargetLine({
    kind: "Resolved",
    summary: resolvedSummary,
    countLabel: "failing target",
    fallbackValues: targetDelta.resolved,
    verb: "no longer appear"
  });
  pushTargetLine({
    kind: "Remaining",
    summary: remainingSummary,
    countLabel: "failing target",
    fallbackValues: targetDelta.remaining,
    verb: "still appear"
  });
  pushTargetLine({
    kind: "New",
    summary: introducedSummary,
    countLabel: "failing target",
    fallbackValues: targetDelta.introduced,
    verb: "appeared"
  });

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
    lines: lines.slice(0, 4)
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
  const baselineCommand = state.runner.baselineCommand ?? state.command;

  if (baselineCommand?.mode === "argv") {
    return {
      command: [...baselineCommand.argv]
    };
  }

  if (baselineCommand?.mode === "shell") {
    return {
      shellCommand: baselineCommand.shellCommand
    };
  }

  throw new Error(
    "Cached test-status run cannot be rerun because the original command was not stored. Run `sift exec --preset test-status -- <test command>` again."
  );
}

export function getRemainingPytestRerunCommand(state: CachedTestStatusRun): string[] {
  if (!isRemainingSubsetAvailable(state) || !state.runner.subset.baseArgv) {
    throw new Error(
      "Cached test-status run cannot use `sift rerun --remaining`. Automatic remaining-subset reruns currently support only argv-mode `pytest ...` or `python -m pytest ...` commands. Run a narrowed command manually with `sift exec --preset test-status -- <narrowed pytest command>`."
    );
  }

  const remainingNodeIds = getRemainingPytestNodeIds(state);
  return [...state.runner.subset.baseArgv, ...remainingNodeIds];
}
