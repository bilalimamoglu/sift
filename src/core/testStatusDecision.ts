import { z } from "zod";
import type {
  FailureBucket,
  FailureBucketType,
  TestStatusAnalysis
} from "./heuristics.js";
import type { RawSliceStrategy } from "../types.js";

export type DiagnoseActionCode =
  | "fix_dominant_blocker"
  | "read_source_for_bucket"
  | "read_raw_for_exact_traceback"
  | "insufficient_signal";
export type TestStatusDecisionKind = "stop" | "zoom" | "read_source" | "read_raw";

export interface TestStatusMiniDiff {
  added_paths?: number;
  removed_models?: number;
  changed_task_mappings?: number;
}

export interface TestStatusDiagnoseBucket {
  bucket_index: number;
  label: string;
  count: number;
  root_cause: string;
  evidence: string[];
  bucket_confidence: number;
  root_cause_confidence: number;
  dominant: boolean;
  secondary_visible_despite_blocker: boolean;
  mini_diff: TestStatusMiniDiff | null;
}

export interface TestStatusReadTarget {
  file: string;
  line: number | null;
  why: string;
  bucket_index: number;
  context_hint: {
    start_line: number | null;
    end_line: number | null;
    search_hint: string | null;
  };
}

export interface TestStatusFamilySummary {
  prefix: string;
  count: number;
}

export interface TestStatusTargetSummary {
  count: number;
  families: TestStatusFamilySummary[];
}

export interface TestStatusDiagnoseContract {
  status: "ok" | "insufficient";
  diagnosis_complete: boolean;
  raw_needed: boolean;
  additional_source_read_likely_low_value: boolean;
  read_raw_only_if: string | null;
  decision: TestStatusDecisionKind;
  dominant_blocker_bucket_index: number | null;
  provider_used: boolean;
  provider_confidence: number | null;
  provider_failed: boolean;
  raw_slice_used: boolean;
  raw_slice_strategy: RawSliceStrategy;
  resolved_tests: string[];
  remaining_tests: string[];
  main_buckets: TestStatusDiagnoseBucket[];
  read_targets: TestStatusReadTarget[];
  next_best_action: {
    code: DiagnoseActionCode;
    bucket_index: number | null;
    note: string;
  };
}

export interface TestStatusPublicDiagnoseContract
  extends Omit<TestStatusDiagnoseContract, "resolved_tests" | "remaining_tests"> {
  resolved_summary: TestStatusTargetSummary;
  remaining_summary: TestStatusTargetSummary;
  remaining_subset_available: boolean;
  resolved_tests?: string[];
  remaining_tests?: string[];
}

export interface TestStatusDecision {
  contract: TestStatusDiagnoseContract;
  standardText: string;
  focusedText: string;
  verboseText: string;
}

export interface TestStatusProviderSupplement {
  diagnosis_complete: boolean;
  raw_needed: boolean;
  additional_source_read_likely_low_value: boolean;
  read_raw_only_if: string | null;
  decision: TestStatusDecisionKind;
  provider_confidence: number | null;
  bucket_supplements: Array<{
    label: string;
    count: number;
    root_cause: string;
    anchor: {
      file: string | null;
      line: number | null;
      search_hint: string | null;
    };
    fix_hint: string | null;
    confidence: number;
  }>;
  next_best_action: {
    code: DiagnoseActionCode;
    bucket_index: number | null;
    note: string;
  };
}

export interface TestStatusContractOverrides {
  diagnosis_complete?: boolean;
  raw_needed?: boolean;
  additional_source_read_likely_low_value?: boolean;
  read_raw_only_if?: string | null;
  decision?: TestStatusDecisionKind;
  provider_used?: boolean;
  provider_confidence?: number | null;
  provider_failed?: boolean;
  raw_slice_used?: boolean;
  raw_slice_strategy?: RawSliceStrategy;
  next_best_action?: TestStatusDiagnoseContract["next_best_action"];
}

export const TEST_STATUS_DIAGNOSE_JSON_CONTRACT =
  '{"status":"ok|insufficient","diagnosis_complete":boolean,"raw_needed":boolean,"additional_source_read_likely_low_value":boolean,"read_raw_only_if":string|null,"decision":"stop|zoom|read_source|read_raw","dominant_blocker_bucket_index":number|null,"provider_used":boolean,"provider_confidence":number|null,"provider_failed":boolean,"raw_slice_used":boolean,"raw_slice_strategy":"none|bucket_evidence|traceback_window|head_tail","resolved_summary":{"count":number,"families":[{"prefix":string,"count":number}]},"remaining_summary":{"count":number,"families":[{"prefix":string,"count":number}]},"remaining_subset_available":boolean,"main_buckets":[{"bucket_index":number,"label":string,"count":number,"root_cause":string,"evidence":string[],"bucket_confidence":number,"root_cause_confidence":number,"dominant":boolean,"secondary_visible_despite_blocker":boolean,"mini_diff":{"added_paths"?:number,"removed_models"?:number,"changed_task_mappings"?:number}|null}],"read_targets":[{"file":string,"line":number|null,"why":string,"bucket_index":number,"context_hint":{"start_line":number|null,"end_line":number|null,"search_hint":string|null}}],"next_best_action":{"code":"fix_dominant_blocker|read_source_for_bucket|read_raw_for_exact_traceback|insufficient_signal","bucket_index":number|null,"note":string},"resolved_tests"?:string[],"remaining_tests"?:string[]}';
export const TEST_STATUS_PROVIDER_SUPPLEMENT_JSON_CONTRACT =
  '{"diagnosis_complete":boolean,"raw_needed":boolean,"additional_source_read_likely_low_value":boolean,"read_raw_only_if":string|null,"decision":"stop|zoom|read_source|read_raw","provider_confidence":number|null,"bucket_supplements":[{"label":string,"count":number,"root_cause":string,"anchor":{"file":string|null,"line":number|null,"search_hint":string|null},"fix_hint":string|null,"confidence":number}],"next_best_action":{"code":"fix_dominant_blocker|read_source_for_bucket|read_raw_for_exact_traceback|insufficient_signal","bucket_index":number|null,"note":string}}';

const nextBestActionSchema = z.object({
  code: z.enum([
    "fix_dominant_blocker",
    "read_source_for_bucket",
    "read_raw_for_exact_traceback",
    "insufficient_signal"
  ]),
  bucket_index: z.number().int().nullable(),
  note: z.string().min(1)
});

export const testStatusProviderSupplementSchema = z.object({
  diagnosis_complete: z.boolean(),
  raw_needed: z.boolean(),
  additional_source_read_likely_low_value: z.boolean(),
  read_raw_only_if: z.string().nullable(),
  decision: z.enum(["stop", "zoom", "read_source", "read_raw"]),
  provider_confidence: z.number().min(0).max(1).nullable(),
  bucket_supplements: z
    .array(
      z.object({
        label: z.string().min(1),
        count: z.number().int().positive(),
        root_cause: z.string().min(1),
        anchor: z.object({
          file: z.string().nullable(),
          line: z.number().int().nullable(),
          search_hint: z.string().nullable()
        }),
        fix_hint: z.string().nullable(),
        confidence: z.number().min(0).max(1)
      })
    )
    .max(2),
  next_best_action: nextBestActionSchema
});

export const testStatusDiagnoseContractSchema = z.object({
  status: z.enum(["ok", "insufficient"]),
  diagnosis_complete: z.boolean(),
  raw_needed: z.boolean(),
  additional_source_read_likely_low_value: z.boolean(),
  read_raw_only_if: z.string().nullable(),
  decision: z.enum(["stop", "zoom", "read_source", "read_raw"]),
  dominant_blocker_bucket_index: z.number().int().nullable(),
  provider_used: z.boolean(),
  provider_confidence: z.number().min(0).max(1).nullable(),
  provider_failed: z.boolean(),
  raw_slice_used: z.boolean(),
  raw_slice_strategy: z.enum(["none", "bucket_evidence", "traceback_window", "head_tail"]),
  resolved_tests: z.array(z.string()),
  remaining_tests: z.array(z.string()),
  main_buckets: z.array(
    z.object({
      bucket_index: z.number().int(),
      label: z.string(),
      count: z.number().int(),
      root_cause: z.string(),
      evidence: z.array(z.string()).max(2),
      bucket_confidence: z.number(),
      root_cause_confidence: z.number(),
      dominant: z.boolean(),
      secondary_visible_despite_blocker: z.boolean(),
      mini_diff: z
        .object({
          added_paths: z.number().int().optional(),
          removed_models: z.number().int().optional(),
          changed_task_mappings: z.number().int().optional()
        })
        .nullable()
    })
  ),
  read_targets: z
    .array(
      z.object({
        file: z.string().min(1),
        line: z.number().int().nullable(),
        why: z.string().min(1),
        bucket_index: z.number().int(),
        context_hint: z.object({
          start_line: z.number().int().nullable(),
          end_line: z.number().int().nullable(),
          search_hint: z.string().nullable()
        })
      })
    )
    .max(5),
  next_best_action: nextBestActionSchema
});

const testStatusTargetSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  families: z
    .array(
      z.object({
        prefix: z.string().min(1),
        count: z.number().int().nonnegative()
      })
    )
    .max(5)
});

export const testStatusPublicDiagnoseContractSchema = testStatusDiagnoseContractSchema
  .omit({
    resolved_tests: true,
    remaining_tests: true
  })
  .extend({
    resolved_summary: testStatusTargetSummarySchema,
    remaining_summary: testStatusTargetSummarySchema,
    remaining_subset_available: z.boolean(),
    resolved_tests: z.array(z.string()).optional(),
    remaining_tests: z.array(z.string()).optional()
  });

export function parseTestStatusProviderSupplement(input: string): TestStatusProviderSupplement {
  return testStatusProviderSupplementSchema.parse(JSON.parse(input));
}

interface GenericBucket {
  type: FailureBucketType;
  headline: string;
  summaryLines: string[];
  reason: string;
  count: number;
  confidence: number;
  representativeItems: FailureBucket["representativeItems"];
  entities: string[];
  hint?: string;
  overflowCount: number;
  overflowLabel: string;
  labelOverride?: string;
  coverage: {
    error: number;
    failed: number;
  };
  source: "heuristic" | "provider" | "unknown";
}

interface ExtendedBucketSpec {
  prefix: string;
  type: FailureBucketType;
  label: string;
  genericTitle: string;
  defaultCoverage: "error" | "failed" | "mixed";
  rootCauseConfidence: number;
  dominantPriority?: number;
  dominantBlocker?: boolean;
  why: string;
  fix: string;
}

const extendedBucketSpecs: readonly ExtendedBucketSpec[] = [
  {
    prefix: "snapshot mismatch:",
    type: "snapshot_mismatch",
    label: "snapshot mismatch",
    genericTitle: "Snapshot mismatches",
    defaultCoverage: "failed",
    rootCauseConfidence: 0.84,
    why: "it contains the failing snapshot expectation behind this bucket",
    fix: "Update the snapshots if these output changes are intentional, then rerun the suite."
  },
  {
    prefix: "timeout:",
    type: "timeout_failure",
    label: "timeout",
    genericTitle: "Timeout failures",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.9,
    why: "it contains the test or fixture that exceeded the timeout threshold",
    fix: "Check for deadlocks, slow setup, or increase the timeout threshold before rerunning."
  },
  {
    prefix: "permission:",
    type: "permission_denied_failure",
    label: "permission denied",
    genericTitle: "Permission failures",
    defaultCoverage: "error",
    rootCauseConfidence: 0.85,
    why: "it contains the file, socket, or port access that was denied",
    fix: "Check file or port permissions in the CI environment before rerunning."
  },
  {
    prefix: "async loop:",
    type: "async_event_loop_failure",
    label: "async event loop",
    genericTitle: "Async event loop failures",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.88,
    why: "it contains the async setup or coroutine that caused the event loop error",
    fix: "Check event loop scope and pytest-asyncio configuration before rerunning."
  },
  {
    prefix: "fixture teardown:",
    type: "fixture_teardown_failure",
    label: "fixture teardown",
    genericTitle: "Fixture teardown failures",
    defaultCoverage: "error",
    rootCauseConfidence: 0.85,
    why: "it contains the fixture teardown path that failed after the test body completed",
    fix: "Inspect the teardown cleanup path and restore idempotent fixture cleanup before rerunning."
  },
  {
    prefix: "db migration:",
    type: "db_migration_failure",
    label: "db migration",
    genericTitle: "DB migration failures",
    defaultCoverage: "error",
    rootCauseConfidence: 0.9,
    why: "it contains the migration or model definition behind the missing table or relation",
    fix: "Run pending migrations or fix the expected model schema before rerunning."
  },
  {
    prefix: "configuration:",
    type: "configuration_error",
    label: "configuration error",
    genericTitle: "Configuration errors",
    defaultCoverage: "error",
    rootCauseConfidence: 0.95,
    dominantPriority: 4,
    dominantBlocker: true,
    why: "it contains the pytest configuration or conftest setup error that blocks the run",
    fix: "Fix the pytest configuration, CLI usage, or conftest import error before rerunning."
  },
  {
    prefix: "xdist worker crash:",
    type: "xdist_worker_crash",
    label: "xdist worker crash",
    genericTitle: "xdist worker crashes",
    defaultCoverage: "error",
    rootCauseConfidence: 0.92,
    dominantPriority: 3,
    why: "it contains the worker startup or shared-state path that crashed an xdist worker",
    fix: "Check shared state, worker startup hooks, or resource contention between workers before rerunning."
  },
  {
    prefix: "type error:",
    type: "type_error_failure",
    label: "type error",
    genericTitle: "Type errors",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.8,
    why: "it contains the call site or fixture value that triggered the type error",
    fix: "Inspect the mismatched argument or object shape and rerun the full suite at standard."
  },
  {
    prefix: "resource leak:",
    type: "resource_leak_warning",
    label: "resource leak",
    genericTitle: "Resource leak warnings",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.74,
    why: "it contains the warning source behind the leaked file, socket, or coroutine",
    fix: "Close the leaked resource or suppress the warning only if the cleanup is intentional."
  },
  {
    prefix: "django db access:",
    type: "django_db_access_denied",
    label: "django db access",
    genericTitle: "Django DB access failures",
    defaultCoverage: "error",
    rootCauseConfidence: 0.95,
    why: "it needs the @pytest.mark.django_db decorator or fixture permission to access the database",
    fix: "Add @pytest.mark.django_db to the test or class before rerunning."
  },
  {
    prefix: "network:",
    type: "network_failure",
    label: "network failure",
    genericTitle: "Network failures",
    defaultCoverage: "error",
    rootCauseConfidence: 0.88,
    dominantPriority: 2,
    why: "it contains the host, URL, or TLS path behind the network failure",
    fix: "Check DNS, outbound network access, retries, or TLS trust before rerunning."
  },
  {
    prefix: "segfault:",
    type: "subprocess_crash_segfault",
    label: "segfault",
    genericTitle: "Segfault crashes",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.8,
    why: "it contains the subprocess or native extension path that crashed with SIGSEGV",
    fix: "Inspect the native extension, subprocess boundary, or incompatible binary before rerunning."
  },
  {
    prefix: "flaky:",
    type: "flaky_test_detected",
    label: "flaky test",
    genericTitle: "Flaky test detections",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.72,
    why: "it contains the rerun-prone test that behaved inconsistently across attempts",
    fix: "Stabilize the nondeterministic test or fixture before relying on reruns."
  },
  {
    prefix: "serialization:",
    type: "serialization_encoding_failure",
    label: "serialization or encoding",
    genericTitle: "Serialization or encoding failures",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.78,
    why: "it contains the serialization or decoding path behind the malformed payload",
    fix: "Inspect the encoded payload, serializer, or fixture data before rerunning."
  },
  {
    prefix: "file not found:",
    type: "file_not_found_failure",
    label: "file not found",
    genericTitle: "Missing file failures",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.82,
    why: "it contains the missing file path or fixture artifact required by the test",
    fix: "Restore the missing file, fixture artifact, or working-directory assumption before rerunning."
  },
  {
    prefix: "memory:",
    type: "memory_error",
    label: "memory error",
    genericTitle: "Memory failures",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.78,
    why: "it contains the allocation path that exhausted available memory",
    fix: "Reduce memory pressure or investigate the large allocation before rerunning."
  },
  {
    prefix: "deprecation as error:",
    type: "deprecation_warning_as_error",
    label: "deprecation as error",
    genericTitle: "Deprecation warnings as errors",
    defaultCoverage: "mixed",
    rootCauseConfidence: 0.74,
    why: "it contains the deprecated API or warning filter that is failing the test run",
    fix: "Update the deprecated call site or relax the warning policy only if that is intentional."
  },
  {
    prefix: "xfail strict:",
    type: "xfail_strict_unexpected_pass",
    label: "strict xfail unexpected pass",
    genericTitle: "Strict xfail unexpected passes",
    defaultCoverage: "failed",
    rootCauseConfidence: 0.78,
    why: "it contains the strict xfail case that unexpectedly passed",
    fix: "Remove or update the strict xfail expectation if the test is now passing intentionally."
  }
];

function findExtendedBucketSpec(reason: string): ExtendedBucketSpec | null {
  return extendedBucketSpecs.find((spec) => reason.startsWith(spec.prefix)) ?? null;
}

function extractReasonDetail(reason: string, prefix: string): string | null {
  const detail = reason.slice(prefix.length).trim();
  return detail.length > 0 ? detail : null;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function normalizeTestId(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

function extractTestFamilyPrefix(value: string): string {
  const normalized = normalizeTestId(value);
  const testsMatch = normalized.match(/^(tests\/[^/]+\/)/);
  if (testsMatch) {
    return testsMatch[1]!;
  }

  const filePart = normalized.split("::")[0]?.trim() ?? "";
  if (!filePart.includes("/")) {
    return "other";
  }

  const segments = filePart.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length === 0) {
    return "other";
  }

  return `${segments[0]}/`;
}

function buildTestTargetSummary(values: readonly string[]): TestStatusTargetSummary {
  const counts = new Map<string, number>();

  for (const value of values) {
    const prefix = extractTestFamilyPrefix(value);
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
    count: values.length,
    families
  };
}

function formatTargetSummary(summary: TestStatusTargetSummary): string {
  if (summary.count === 0) {
    return "count=0";
  }

  const families =
    summary.families.length > 0
      ? summary.families.map((family) => `${family.prefix}${family.count}`).join(", ")
      : "none";

  return `count=${summary.count}; families=${families}`;
}

function classifyGenericBucketType(reason: string): FailureBucketType {
  const extended = findExtendedBucketSpec(reason);
  if (extended) {
    return extended.type;
  }

  if (reason.startsWith("missing test env:")) {
    return "shared_environment_blocker";
  }

  if (reason.startsWith("fixture guard:")) {
    return "collection_failure";
  }

  if (reason.startsWith("service unavailable:")) {
    return "runtime_failure";
  }

  if (reason.startsWith("db refused:")) {
    return "runtime_failure";
  }

  if (reason.startsWith("auth bypass absent:")) {
    return "runtime_failure";
  }

  if (reason.startsWith("missing module:")) {
    return "import_dependency_failure";
  }

  if (reason.startsWith("assertion failed:")) {
    return "assertion_failure";
  }

  if (/^[A-Z][A-Za-z]+(?:Error|Exception):/.test(reason)) {
    return "runtime_failure";
  }

  return "unknown_failure";
}

function isUnknownBucket(bucket: Pick<GenericBucket, "reason" | "source">): boolean {
  return bucket.source === "unknown" || bucket.reason.startsWith("unknown ");
}

function classifyVisibleStatusForLabel(args: {
  label: string;
  errorLabels: Set<string>;
  failedLabels: Set<string>;
}): "error" | "failed" | "mixed" | "unknown" {
  const isError = args.errorLabels.has(args.label);
  const isFailed = args.failedLabels.has(args.label);
  if (isError && isFailed) {
    return "mixed";
  }
  if (isError) {
    return "error";
  }
  if (isFailed) {
    return "failed";
  }
  return "unknown";
}

function inferCoverageFromReason(reason: string): "error" | "failed" | "mixed" {
  const extended = findExtendedBucketSpec(reason);
  if (extended) {
    return extended.defaultCoverage;
  }

  if (
    reason.startsWith("missing test env:") ||
    reason.startsWith("fixture guard:") ||
    reason.startsWith("service unavailable:") ||
    reason.startsWith("db refused:") ||
    reason.startsWith("auth bypass absent:") ||
    reason.startsWith("missing module:")
  ) {
    return "error";
  }

  if (reason.startsWith("assertion failed:")) {
    return "failed";
  }

  return "mixed";
}

function buildCoverageCounts(args: {
  count: number;
  coverageKind: "error" | "failed" | "mixed";
}): GenericBucket["coverage"] {
  if (args.coverageKind === "error") {
    return {
      error: args.count,
      failed: 0
    };
  }

  if (args.coverageKind === "failed") {
    return {
      error: 0,
      failed: args.count
    };
  }

  return {
    error: 0,
    failed: 0
  };
}

function buildGenericBuckets(analysis: TestStatusAnalysis): GenericBucket[] {
  const buckets: GenericBucket[] = [];
  const grouped = new Map<string, GenericBucket>();
  const errorLabels = new Set(analysis.visibleErrorLabels);
  const failedLabels = new Set(analysis.visibleFailedLabels);

  const push = (reason: string, item: FailureBucket["representativeItems"][number]) => {
    const coverageKind = (() => {
      const status = classifyVisibleStatusForLabel({
        label: item.label,
        errorLabels,
        failedLabels
      });
      return status === "unknown" ? inferCoverageFromReason(reason) : status;
    })();
    const key = `${classifyGenericBucketType(reason)}:${coverageKind}:${reason}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      if (coverageKind === "error") {
        existing.coverage.error += 1;
      } else if (coverageKind === "failed") {
        existing.coverage.failed += 1;
      }
      if (
        !existing.representativeItems.some((entry) => entry.label === item.label) &&
        existing.representativeItems.length < 6
      ) {
        existing.representativeItems.push(item);
      }
      return;
    }

    grouped.set(key, {
      type: classifyGenericBucketType(reason),
      headline: "",
      summaryLines: [],
      reason,
      count: 1,
      confidence: (() => {
        const extended = findExtendedBucketSpec(reason);
        if (extended) {
          return Math.max(0.72, Math.min(extended.rootCauseConfidence, 0.82));
        }
        return reason.startsWith("assertion failed:") || /^[A-Z][A-Za-z]+(?:Error|Exception):/.test(reason)
          ? 0.74
          : 0.62;
      })(),
      representativeItems: [item],
      entities: [],
      hint: undefined,
      overflowCount: 0,
      overflowLabel: "failing tests/modules",
      coverage: buildCoverageCounts({
        count: 1,
        coverageKind
      }),
      source: "heuristic"
    });
  };

  for (const item of [...analysis.collectionItems, ...analysis.inlineItems]) {
    push(item.reason, item);
  }

  for (const bucket of grouped.values()) {
    const title =
      findExtendedBucketSpec(bucket.reason)?.genericTitle ??
      (bucket.type === "assertion_failure" || bucket.type === "snapshot_mismatch"
        ? "Assertion failures"
        : bucket.type === "import_dependency_failure"
          ? "Import/dependency failures"
          : bucket.type === "collection_failure"
            ? "Collection or fixture failures"
            : "Runtime failures");
    bucket.headline = `${title}: ${formatCount(bucket.count, "visible failure")} share ${bucket.reason}.`;
    bucket.summaryLines = [bucket.headline];
    bucket.overflowCount = Math.max(bucket.count - bucket.representativeItems.length, 0);
    buckets.push(bucket);
  }

  return buckets.sort((left, right) => right.count - left.count);
}

function normalizeBucketIdentity(bucket: Pick<GenericBucket, "type" | "reason">): string {
  return `${bucket.type}:${bucket.reason.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function mergeRepresentativeItems(
  left: FailureBucket["representativeItems"],
  right: FailureBucket["representativeItems"]
): FailureBucket["representativeItems"] {
  const merged: FailureBucket["representativeItems"] = [...left];

  for (const item of right) {
    if (
      merged.some(
        (existing) => existing.label === item.label && existing.reason === item.reason
      )
    ) {
      continue;
    }

    if (merged.length >= 6) {
      break;
    }

    merged.push(item);
  }

  return merged;
}

function mergeBucketDetails(existing: GenericBucket, incoming: GenericBucket): GenericBucket {
  const representativeItems = mergeRepresentativeItems(
    existing.representativeItems,
    incoming.representativeItems
  );
  const count = Math.max(existing.count, incoming.count);

  return {
    ...existing,
    headline:
      existing.summaryLines.length >= incoming.summaryLines.length &&
      existing.headline.length >= incoming.headline.length
        ? existing.headline
        : incoming.headline,
    summaryLines:
      existing.summaryLines.length >= incoming.summaryLines.length
        ? existing.summaryLines
        : incoming.summaryLines,
    count,
    confidence: Math.max(existing.confidence, incoming.confidence),
    representativeItems,
    entities: unique([...existing.entities, ...incoming.entities]),
    hint: existing.hint ?? incoming.hint,
    overflowCount: Math.max(
      existing.overflowCount,
      incoming.overflowCount,
      count - representativeItems.length
    ),
    overflowLabel: existing.overflowLabel || incoming.overflowLabel,
    labelOverride: existing.labelOverride ?? incoming.labelOverride,
    coverage: {
      error: Math.max(existing.coverage.error, incoming.coverage.error),
      failed: Math.max(existing.coverage.failed, incoming.coverage.failed)
    },
    source: existing.source
  };
}

function inferFailureBucketCoverage(bucket: FailureBucket, analysis: TestStatusAnalysis): GenericBucket["coverage"] {
  const errorLabels = new Set(analysis.visibleErrorLabels);
  const failedLabels = new Set(analysis.visibleFailedLabels);
  let error = 0;
  let failed = 0;

  for (const item of bucket.representativeItems) {
    const status = classifyVisibleStatusForLabel({
      label: item.label,
      errorLabels,
      failedLabels
    });
    if (status === "error") {
      error += 1;
    } else if (status === "failed") {
      failed += 1;
    }
  }

  const claimed = bucket.countClaimed ?? bucket.countVisible;
  if (
    bucket.type === "contract_snapshot_drift" ||
    bucket.type === "assertion_failure" ||
    bucket.type === "snapshot_mismatch"
  ) {
    return {
      error,
      failed: Math.max(failed, claimed)
    };
  }

  if (
    bucket.type === "shared_environment_blocker" ||
    bucket.type === "import_dependency_failure" ||
    bucket.type === "collection_failure" ||
    bucket.type === "fixture_guard_failure" ||
    bucket.type === "permission_denied_failure" ||
    bucket.type === "fixture_teardown_failure" ||
    bucket.type === "db_migration_failure" ||
    bucket.type === "configuration_error" ||
    bucket.type === "xdist_worker_crash" ||
    bucket.type === "django_db_access_denied" ||
    bucket.type === "network_failure" ||
    bucket.type === "service_unavailable" ||
    bucket.type === "db_connection_failure" ||
    bucket.type === "auth_bypass_absent"
  ) {
    return {
      error: Math.max(error, claimed),
      failed
    };
  }

  return {
    error,
    failed
  };
}

function mergeBuckets(
  analysis: TestStatusAnalysis,
  extraBuckets: GenericBucket[] = []
): GenericBucket[] {
  const mergedByIdentity = new Map<string, GenericBucket>();
  const merged: GenericBucket[] = [];

  const pushBucket = (bucket: GenericBucket) => {
    const identity = normalizeBucketIdentity(bucket);
    const existing = mergedByIdentity.get(identity);

    if (existing) {
      const replacement = mergeBucketDetails(existing, bucket);
      const index = merged.indexOf(existing);
      if (index >= 0) {
        merged[index] = replacement;
      }
      mergedByIdentity.set(identity, replacement);
      return;
    }

    merged.push(bucket);
    mergedByIdentity.set(identity, bucket);
  };

  for (const bucket of analysis.buckets.map((bucket) => ({
    type: bucket.type,
    headline: bucket.headline,
    summaryLines: [...bucket.summaryLines],
    reason: bucket.reason,
    count: bucket.countClaimed ?? bucket.countVisible,
    confidence: bucket.confidence,
    representativeItems: [...bucket.representativeItems],
    entities: [...bucket.entities],
    hint: bucket.hint,
    overflowCount: bucket.overflowCount,
    overflowLabel: bucket.overflowLabel,
    coverage: inferFailureBucketCoverage(bucket, analysis),
    source: "heuristic" as const
  }))) {
    pushBucket(bucket);
  }

  const coveredLabels = new Set(
    merged.flatMap((bucket) => bucket.representativeItems.map((item) => item.label))
  );
  for (const bucket of buildGenericBuckets(analysis)) {
    const identity = normalizeBucketIdentity(bucket);
    const unseenItems = bucket.representativeItems.filter(
      (item) => !coveredLabels.has(item.label)
    );
    if (!mergedByIdentity.has(identity) && unseenItems.length === 0) {
      continue;
    }

    pushBucket({
      ...bucket,
      count: Math.max(bucket.count, unseenItems.length),
      representativeItems:
        mergedByIdentity.has(identity) || unseenItems.length === 0
          ? bucket.representativeItems
          : unseenItems
    });
    for (const item of bucket.representativeItems) {
      coveredLabels.add(item.label);
    }
  }

  for (const bucket of extraBuckets) {
    pushBucket(bucket);
  }

  return merged;
}

function dominantBucketPriority(bucket: GenericBucket): number {
  if (bucket.reason.startsWith("missing test env:")) {
    return 5;
  }
  const extended = findExtendedBucketSpec(bucket.reason);
  if (extended?.dominantPriority !== undefined) {
    return extended.dominantPriority;
  }
  if (bucket.type === "shared_environment_blocker") {
    return 4;
  }
  if (bucket.type === "import_dependency_failure") {
    return 3;
  }
  if (bucket.type === "collection_failure") {
    return 2;
  }
  if (isUnknownBucket(bucket)) {
    return 2;
  }
  if (bucket.type === "contract_snapshot_drift") {
    return 1;
  }
  return 0;
}

function prioritizeBuckets(buckets: GenericBucket[]): GenericBucket[] {
  return [...buckets].sort((left, right) => {
    const priorityDelta = dominantBucketPriority(right) - dominantBucketPriority(left);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    if (right.count !== left.count) {
      return right.count - left.count;
    }

    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    return left.reason.localeCompare(right.reason);
  });
}

function isDominantBlockerType(type: FailureBucketType): boolean {
  return (
    type === "shared_environment_blocker" ||
    type === "configuration_error" ||
    type === "import_dependency_failure" ||
    type === "collection_failure"
  );
}

function labelForBucket(bucket: GenericBucket): string {
  if (bucket.labelOverride) {
    return bucket.labelOverride;
  }

  const extended = findExtendedBucketSpec(bucket.reason);
  if (extended) {
    return extended.label;
  }

  if (bucket.reason.startsWith("missing test env:")) {
    return "missing test env";
  }
  if (bucket.reason.startsWith("fixture guard:")) {
    return "fixture guard";
  }
  if (bucket.reason.startsWith("service unavailable:")) {
    return "service unavailable";
  }
  if (bucket.reason.startsWith("db refused:")) {
    return "db refused";
  }
  if (bucket.reason.startsWith("auth bypass absent:")) {
    return "auth bypass absent";
  }
  if (bucket.type === "contract_snapshot_drift") {
    if (/openapi/i.test(bucket.headline) || bucket.entities.some((value) => value.startsWith("/api/"))) {
      return "route drift";
    }
    if (/schema/i.test(bucket.headline)) {
      return "schema freeze mismatch";
    }
    if (/model/i.test(bucket.headline)) {
      return "model catalog drift";
    }
    return "stale snapshot";
  }
  if (bucket.type === "import_dependency_failure") {
    return "import dependency failure";
  }
  if (bucket.type === "assertion_failure") {
    return "assertion failure";
  }
  if (bucket.type === "snapshot_mismatch") {
    return "snapshot mismatch";
  }
  if (bucket.type === "collection_failure") {
    return "collection failure";
  }
  if (bucket.type === "runtime_failure") {
    return "runtime failure";
  }
  if (bucket.reason.startsWith("unknown setup blocker:")) {
    return "unknown setup blocker";
  }
  if (bucket.reason.startsWith("unknown failure family:")) {
    return "unknown failure family";
  }
  return "unknown failure";
}

function rootCauseConfidenceFor(bucket: GenericBucket): number {
  if (isUnknownBucket(bucket)) {
    return 0.52;
  }

  const extended = findExtendedBucketSpec(bucket.reason);
  if (extended) {
    return extended.rootCauseConfidence;
  }

  if (
    bucket.reason.startsWith("missing test env:") ||
    bucket.reason.startsWith("missing module:") ||
    bucket.reason.startsWith("db refused:") ||
    bucket.reason.startsWith("service unavailable:") ||
    bucket.reason.startsWith("auth bypass absent:")
  ) {
    return 0.95;
  }

  if (bucket.type === "contract_snapshot_drift") {
    return bucket.entities.length > 0 ? 0.92 : 0.76;
  }

  if (bucket.source === "provider") {
    return Math.max(0.6, Math.min(bucket.confidence, 0.82));
  }

  return Math.max(0.6, Math.min(bucket.confidence, 0.88));
}

function buildBucketEvidence(bucket: GenericBucket): string[] {
  const evidence = bucket.representativeItems
    .slice(0, 2)
    .map((item) => `${item.label} -> ${item.reason}`);

  if (evidence.length > 0) {
    return evidence;
  }

  return bucket.entities.slice(0, 2);
}

function formatReadTargetLocation(target: TestStatusReadTarget): string {
  return target.line === null ? target.file : `${target.file}:${target.line}`;
}

function buildReadTargetContextHint(args: {
  bucket: GenericBucket;
  anchor: FailureBucket["representativeItems"][number];
}): TestStatusReadTarget["context_hint"] {
  if (args.anchor.line !== null) {
    return {
      start_line: Math.max(1, args.anchor.line - 5),
      end_line: args.anchor.line + 5,
      search_hint: null
    };
  }

  return {
    start_line: null,
    end_line: null,
    search_hint: buildReadTargetSearchHint(args.bucket, args.anchor)
  };
}

function buildReadTargetWhy(args: {
  bucket: GenericBucket;
  bucketLabel: string;
}): string {
  const envVar = args.bucket.reason.match(/^missing test env:\s+([A-Z][A-Z0-9_]{2,})$/)?.[1];
  if (envVar) {
    return `it contains the ${envVar} setup guard`;
  }

  const extended = findExtendedBucketSpec(args.bucket.reason);
  if (extended) {
    return extended.why;
  }

  if (args.bucket.reason.startsWith("fixture guard:")) {
    return "it contains the fixture/setup guard behind this bucket";
  }

  if (args.bucket.reason.startsWith("db refused:")) {
    return "it contains the database connection setup behind this bucket";
  }

  if (args.bucket.reason.startsWith("service unavailable:")) {
    return "it contains the dependency service call or setup behind this bucket";
  }

  if (args.bucket.reason.startsWith("auth bypass absent:")) {
    return "it contains the auth bypass setup behind this bucket";
  }

  if (args.bucket.reason.startsWith("unknown setup blocker:")) {
    return "it is the first anchored setup failure in this unknown bucket";
  }

  if (args.bucket.reason.startsWith("unknown failure family:")) {
    return "it is the first anchored failing test in this unknown bucket";
  }

  if (args.bucket.type === "contract_snapshot_drift") {
    if (args.bucketLabel === "route drift") {
      return "it maps to the visible route drift bucket";
    }
    if (args.bucketLabel === "model catalog drift") {
      return "it maps to the visible model drift bucket";
    }
    if (args.bucketLabel === "schema freeze mismatch") {
      return "it maps to the visible schema freeze mismatch";
    }
    return "it maps to the visible stale snapshot expectation";
  }

  if (args.bucket.type === "snapshot_mismatch") {
    return "it maps to the visible snapshot mismatch bucket";
  }

  if (args.bucket.type === "import_dependency_failure") {
    return "it is the first visible failing module in this missing dependency bucket";
  }

  if (args.bucket.type === "assertion_failure") {
    return "it is the first visible failing test in this bucket";
  }

  if (args.bucket.type === "collection_failure") {
    return "it is the first visible collection/setup anchor for this bucket";
  }

  return `it maps to the visible ${args.bucketLabel} bucket`;
}

function buildExtendedBucketSearchHint(
  bucket: GenericBucket,
  anchor: FailureBucket["representativeItems"][number]
): string | null {
  const extended = findExtendedBucketSpec(bucket.reason);
  if (!extended) {
    return null;
  }

  const detail = extractReasonDetail(bucket.reason, extended.prefix);
  if (!detail) {
    return anchor.label.split("::")[1]?.trim() ?? anchor.label ?? null;
  }

  if (extended.type === "timeout_failure") {
    const duration = detail.match(/>\s*([0-9]+(?:\.[0-9]+)?s?)/i)?.[1];
    return duration ?? anchor.label.split("::")[1]?.trim() ?? detail;
  }

  if (extended.type === "db_migration_failure") {
    const relation = detail.match(/\b(?:relation|table)\s+([A-Za-z0-9_.-]+)/i)?.[1];
    return relation ?? detail;
  }

  if (extended.type === "network_failure") {
    const url = detail.match(/\bhttps?:\/\/[^\s)'"`]+/i)?.[0];
    const host = detail.match(/\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/)?.[0];
    return url ?? host ?? detail;
  }

  if (extended.type === "xdist_worker_crash") {
    return detail.match(/\bgw\d+\b/)?.[0] ?? detail;
  }

  if (extended.type === "fixture_teardown_failure") {
    return detail.replace(/^of\s+/i, "") || anchor.label;
  }

  if (extended.type === "file_not_found_failure") {
    const path = detail.match(/['"]([^'"]+)['"]/)?.[1];
    return path ?? detail;
  }

  if (extended.type === "permission_denied_failure") {
    const path = detail.match(/['"]([^'"]+)['"]/)?.[1];
    const port = detail.match(/\bport\s+(\d+)\b/i)?.[1];
    return path ?? (port ? `port ${port}` : detail);
  }

  return detail;
}

function buildReadTargetSearchHint(
  bucket: GenericBucket,
  anchor: FailureBucket["representativeItems"][number]
): string | null {
  const envVar = bucket.reason.match(/^missing test env:\s+([A-Z][A-Z0-9_]{2,})$/)?.[1];
  if (envVar) {
    return envVar;
  }

  const extendedHint = buildExtendedBucketSearchHint(bucket, anchor);
  if (extendedHint) {
    return extendedHint;
  }

  if (bucket.type === "contract_snapshot_drift") {
    return bucket.entities.find((value) => value.startsWith("/api/")) ?? bucket.entities[0] ?? null;
  }

  const missingModule = bucket.reason.match(/^missing module:\s+(.+)$/)?.[1];
  if (missingModule) {
    return missingModule;
  }

  const fixtureGuard = bucket.reason.match(/^fixture guard:\s+(.+)$/)?.[1];
  if (fixtureGuard) {
    return fixtureGuard;
  }

  const serviceMarker = bucket.reason.match(
    /^(?:service unavailable|db refused|auth bypass absent):\s+(.+)$/
  )?.[1];
  if (serviceMarker) {
    return serviceMarker;
  }

  const assertionText = bucket.reason.match(/^assertion failed:\s+(.+)$/)?.[1];
  if (assertionText) {
    return assertionText;
  }

  if (bucket.reason.startsWith("unknown ")) {
    return anchor.reason;
  }

  const fallbackLabel = anchor.label.split("::")[1]?.trim();
  return fallbackLabel || null;
}

function buildReadTargets(args: {
  buckets: GenericBucket[];
  dominantBucketIndex: number | null;
}): TestStatusReadTarget[] {
  return args.buckets
    .map((bucket, index) => ({
      bucket,
      bucketIndex: index + 1,
      bucketLabel: labelForBucket(bucket),
      dominant: args.dominantBucketIndex === index + 1
    }))
    .sort((left, right) => {
      if (left.dominant !== right.dominant) {
        return left.dominant ? -1 : 1;
      }
      return left.bucketIndex - right.bucketIndex;
    })
    .flatMap(({ bucket, bucketIndex, bucketLabel }) => {
      const anchor = [...bucket.representativeItems]
        .filter((item) => item.file)
        .sort((left, right) => {
          if ((left.line !== null) !== (right.line !== null)) {
            return left.line !== null ? -1 : 1;
          }
          if (right.anchor_confidence !== left.anchor_confidence) {
            return right.anchor_confidence - left.anchor_confidence;
          }
          return left.label.localeCompare(right.label);
        })[0];

      if (!anchor?.file) {
        return [];
      }

      return [
        {
          file: anchor.file,
          line: anchor.line,
          why: buildReadTargetWhy({
            bucket,
            bucketLabel
          }),
          bucket_index: bucketIndex,
          context_hint: buildReadTargetContextHint({
            bucket,
            anchor
          })
        }
      ];
    })
    .slice(0, 5);
}

function buildConcreteNextNote(args: {
  nextBestAction: TestStatusDiagnoseContract["next_best_action"];
  readTargets: TestStatusReadTarget[];
  hasSecondaryVisibleBucket: boolean;
}): string {
  const primaryTarget =
    args.readTargets.find((target) => target.bucket_index === args.nextBestAction.bucket_index) ??
    args.readTargets[0];
  if (!primaryTarget) {
    return args.nextBestAction.note;
  }

  const lead =
    primaryTarget.context_hint.start_line !== null &&
    primaryTarget.context_hint.end_line !== null
      ? `Read ${primaryTarget.file} lines ${primaryTarget.context_hint.start_line}-${primaryTarget.context_hint.end_line} first; ${primaryTarget.why}.`
      : primaryTarget.context_hint.search_hint
        ? `Search for ${primaryTarget.context_hint.search_hint} in ${primaryTarget.file} first; ${primaryTarget.why}.`
        : `Read ${formatReadTargetLocation(primaryTarget)} first; ${primaryTarget.why}.`;

  if (args.nextBestAction.code === "fix_dominant_blocker") {
    if (
      args.nextBestAction.bucket_index === 1 &&
      args.hasSecondaryVisibleBucket
    ) {
      return "Fix bucket 1 first, then rerun the full suite at standard. Secondary buckets are already visible behind it.";
    }

    return `Fix bucket ${args.nextBestAction.bucket_index ?? 1} first, then rerun the full suite at standard.`;
  }

  if (args.nextBestAction.code === "read_source_for_bucket") {
    return lead;
  }

  if (args.nextBestAction.code === "insufficient_signal") {
    if (args.nextBestAction.note.startsWith("Provider follow-up failed")) {
      return args.nextBestAction.note;
    }
    return `${lead} Then take one deeper sift pass before raw traceback.`;
  }

  return args.nextBestAction.note;
}

function extractMiniDiff(input: string, bucket: GenericBucket): TestStatusMiniDiff | null {
  if (bucket.type !== "contract_snapshot_drift") {
    return null;
  }

  const addedPaths = unique(
    [...input.matchAll(/[+-]\s+'(\/api\/[^']+)'/g)].map((match) => match[1]!)
  ).length;
  const removedModels = unique(
    [...input.matchAll(/[+-]\s+'([A-Za-z0-9._/-]+-[A-Za-z0-9._-]+)'/g)].map((match) => match[1]!)
  ).length;
  const changedTaskMappings = unique(
    [...input.matchAll(/[+-]\s+'([a-z]+(?:_[a-z0-9]+)+)'/g)].map((match) => match[1]!)
  ).length;

  if (addedPaths === 0 && removedModels === 0 && changedTaskMappings === 0) {
    return null;
  }

  return {
    ...(addedPaths > 0 ? { added_paths: addedPaths } : {}),
    ...(removedModels > 0 ? { removed_models: removedModels } : {}),
    ...(changedTaskMappings > 0 ? { changed_task_mappings: changedTaskMappings } : {})
  };
}

function inferSupplementCoverageKind(args: {
  label: string;
  rootCause: string;
  remainingErrors: number;
  remainingFailed: number;
}): "error" | "failed" {
  const extended = findExtendedBucketSpec(args.rootCause);
  if (extended?.defaultCoverage === "error" || extended?.defaultCoverage === "failed") {
    return extended.defaultCoverage;
  }

  const normalized = `${args.label} ${args.rootCause}`.toLowerCase();
  if (
    /env|setup|fixture|import|dependency|service|db|database|auth bypass|collection|connection refused/.test(
      normalized
    )
  ) {
    return "error";
  }

  if (/snapshot|contract|drift|assertion|expected|actual|golden/.test(normalized)) {
    return "failed";
  }

  if (args.remainingErrors > 0 && args.remainingFailed === 0) {
    return "error";
  }

  return "failed";
}

function buildProviderSupplementBuckets(args: {
  supplements: TestStatusProviderSupplement["bucket_supplements"];
  remainingErrors: number;
  remainingFailed: number;
}): GenericBucket[] {
  let remainingErrors = args.remainingErrors;
  let remainingFailed = args.remainingFailed;

  return args.supplements.flatMap((supplement) => {
    const coverageKind = inferSupplementCoverageKind({
      label: supplement.label,
      rootCause: supplement.root_cause,
      remainingErrors,
      remainingFailed
    });
    const budget = coverageKind === "error" ? remainingErrors : remainingFailed;
    const count = Math.max(0, Math.min(supplement.count, budget));
    if (count === 0) {
      return [];
    }

    if (coverageKind === "error") {
      remainingErrors -= count;
    } else {
      remainingFailed -= count;
    }

    const representativeLabel =
      supplement.anchor.file ??
      `${supplement.label} supplement`;
    const representativeItem: FailureBucket["representativeItems"][number] = {
      label: representativeLabel,
      reason: supplement.root_cause,
      group: supplement.label,
      file: supplement.anchor.file,
      line: supplement.anchor.line,
      anchor_kind:
        supplement.anchor.file && supplement.anchor.line !== null
          ? "traceback"
          : supplement.anchor.file
            ? "test_label"
            : supplement.anchor.search_hint
              ? "entity"
              : "none",
      anchor_confidence: Math.max(0.4, Math.min(supplement.confidence, 0.82))
    };

    return [
      {
        type: classifyGenericBucketType(supplement.root_cause),
        headline: `${supplement.label}: ${formatCount(count, "visible failure")} share ${supplement.root_cause}.`,
        summaryLines: [
          `${supplement.label}: ${formatCount(count, "visible failure")} share ${supplement.root_cause}.`
        ],
        reason: supplement.root_cause,
        count,
        confidence: Math.max(0.4, Math.min(supplement.confidence, 0.82)),
        representativeItems: [representativeItem],
        entities: supplement.anchor.search_hint ? [supplement.anchor.search_hint] : [],
        hint: supplement.fix_hint ?? undefined,
        overflowCount: Math.max(count - 1, 0),
        overflowLabel: "failing tests/modules",
        labelOverride: supplement.label,
        coverage: buildCoverageCounts({
          count,
          coverageKind
        }),
        source: "provider"
      }
    ];
  });
}

function pickUnknownAnchor(args: {
  analysis: TestStatusAnalysis;
  kind: "error" | "failed";
}): FailureBucket["representativeItems"][number] | null {
  const fromStatusItems =
    args.kind === "error"
      ? args.analysis.visibleErrorItems[0]
      : null;

  if (fromStatusItems) {
    return {
      label: fromStatusItems.label,
      reason: fromStatusItems.reason,
      group: fromStatusItems.group,
      file: fromStatusItems.file,
      line: fromStatusItems.line,
      anchor_kind: fromStatusItems.anchor_kind,
      anchor_confidence: fromStatusItems.anchor_confidence
    };
  }

  const label =
    args.kind === "error"
      ? args.analysis.visibleErrorLabels[0]
      : args.analysis.visibleFailedLabels[0];
  if (label) {
    const normalizedLabel = normalizeTestId(label);
    const fileMatch = normalizedLabel.match(/^([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b/);
    const file = fileMatch?.[1] ?? normalizedLabel.split("::")[0] ?? null;
    return {
      label,
      reason:
        args.kind === "error"
          ? "setup failures share a repeated but unclassified pattern"
          : "failing tests share a repeated but unclassified pattern",
      group: args.kind === "error" ? "unknown setup blocker" : "unknown failure family",
      file: file && file !== label ? file : null,
      line: null,
      anchor_kind: file && file !== label ? "test_label" : "none",
      anchor_confidence: file && file !== label ? 0.6 : 0
    };
  }

  return null;
}

function buildUnknownBucket(args: {
  analysis: TestStatusAnalysis;
  kind: "error" | "failed";
  count: number;
}): GenericBucket | null {
  if (args.count <= 0) {
    return null;
  }

  const anchor = pickUnknownAnchor(args);
  const isError = args.kind === "error";
  const label = isError ? "unknown setup blocker" : "unknown failure family";
  const reason = isError
    ? "unknown setup blocker: setup failures share a repeated but unclassified pattern"
    : "unknown failure family: failing tests share a repeated but unclassified pattern";
  const firstConcreteSignal =
    anchor &&
    anchor.reason !== reason &&
    anchor.reason !== "setup failures share a repeated but unclassified pattern" &&
    anchor.reason !== "failing tests share a repeated but unclassified pattern"
      ? `First concrete signal: ${anchor.reason}`
      : null;

  return {
    type: "unknown_failure",
    headline: `${label}: ${formatCount(args.count, "visible failure")} share a repeated but unclassified pattern.`,
    summaryLines: [
      `${label}: ${formatCount(args.count, "visible failure")} share a repeated but unclassified pattern.`,
      firstConcreteSignal
    ].filter((value): value is string => Boolean(value)),
    reason,
    count: args.count,
    confidence: 0.45,
    representativeItems: anchor ? [anchor] : [],
    entities: [],
    hint: isError
      ? "Take one deeper sift pass or inspect the first anchored setup failure."
      : "Take one deeper sift pass or inspect the first anchored failing test.",
    overflowCount: Math.max(args.count - (anchor ? 1 : 0), 0),
    overflowLabel: "failing tests/modules",
    labelOverride: label,
    coverage: buildCoverageCounts({
      count: args.count,
      coverageKind: isError ? "error" : "failed"
    }),
    source: "unknown"
  };
}

function buildCoverageResiduals(args: {
  analysis: TestStatusAnalysis;
  buckets: GenericBucket[];
}): { remainingErrors: number; remainingFailed: number } {
  const covered = args.buckets.reduce(
    (totals, bucket) => ({
      error: totals.error + bucket.coverage.error,
      failed: totals.failed + bucket.coverage.failed
    }),
    {
      error: 0,
      failed: 0
    }
  );

  return {
    remainingErrors: Math.max(args.analysis.errors - Math.min(args.analysis.errors, covered.error), 0),
    remainingFailed: Math.max(args.analysis.failed - Math.min(args.analysis.failed, covered.failed), 0)
  };
}

function buildOutcomeLines(analysis: TestStatusAnalysis): string[] {
  if (analysis.noTestsCollected) {
    return ["- Tests did not run.", "- Collected 0 items."];
  }

  if (analysis.failed === 0 && analysis.errors === 0 && analysis.passed > 0) {
    const parts = [formatCount(analysis.passed, "test")];
    if (analysis.skipped > 0) {
      parts.push(formatCount(analysis.skipped, "skip"));
    }
    return ["- Tests passed.", `- ${parts.join(", ")}.`];
  }

  if (analysis.collectionErrorCount && analysis.failed === 0) {
    return [
      "- Tests did not complete.",
      `- ${formatCount(analysis.collectionErrorCount, "error")} occurred during collection.`
    ];
  }

  const counts: string[] = [];
  if (analysis.failed > 0) {
    counts.push(formatCount(analysis.failed, "test failed", "tests failed"));
  }
  if (analysis.errors > 0) {
    counts.push(formatCount(analysis.errors, "error occurred", "errors occurred"));
  }

  if (counts.length === 0) {
    return ["- Tests did not pass."];
  }

  return ["- Tests did not pass.", `- ${counts.join(". ")}.`];
}

function buildStopSignal(contract: TestStatusDiagnoseContract): string {
  if (contract.diagnosis_complete && !contract.raw_needed) {
    return "- Stop signal: diagnosis complete; raw not needed.";
  }

  if (contract.raw_needed && contract.read_raw_only_if) {
    return `- Stop signal: diagnosis incomplete; raw only if ${contract.read_raw_only_if}.`;
  }

  return "- Stop signal: diagnosis incomplete; provider or raw traceback may still help.";
}

function deriveDecision(contract: Omit<TestStatusDiagnoseContract, "decision">): TestStatusDecisionKind {
  if (contract.raw_needed || contract.provider_failed) {
    return "read_raw";
  }

  if (!contract.diagnosis_complete) {
    return "zoom";
  }

  if (
    contract.main_buckets.length === 0 &&
    contract.next_best_action.note === "No failing buckets remain."
  ) {
    return "stop";
  }

  if (contract.next_best_action.code === "read_source_for_bucket") {
    return "read_source";
  }

  return "stop";
}

function buildDecisionLine(contract: TestStatusDiagnoseContract): string {
  if (contract.decision === "stop") {
    return "- Decision: stop and act. Do not escalate unless you need exact traceback lines.";
  }

  if (contract.decision === "read_source") {
    return "- Decision: read source next. Do not escalate unless exact traceback lines are still needed.";
  }

  if (contract.decision === "zoom") {
    return "- Decision: zoom. One deeper sift pass is justified before raw.";
  }

  return "- Decision: raw only if exact traceback is required.";
}

function buildComparisonLines(contract: TestStatusDiagnoseContract): string[] {
  const lines: string[] = [];

  if (contract.resolved_tests.length > 0) {
    lines.push(
      `- Resolved in this rerun: ${formatCount(contract.resolved_tests.length, "test")} dropped out of the failing set.`
    );
  }

  if (contract.resolved_tests.length > 0 && contract.remaining_tests.length > 0) {
    lines.push(
      `- Remaining failing targets: ${formatCount(contract.remaining_tests.length, "test/module", "tests/modules")}.`
    );
  }

  return lines;
}

function renderBucketHeadline(bucket: TestStatusDiagnoseBucket): string {
  return `- Bucket ${bucket.bucket_index}: ${bucket.label} (${bucket.count}) -> ${bucket.root_cause}`;
}

interface StandardBucketSupport {
  headline: string;
  firstConcreteSignalText: string | null;
  anchorText: string | null;
  fixText: string | null;
}

function buildStandardAnchorText(target: TestStatusReadTarget | undefined): string | null {
  if (!target) {
    return null;
  }

  if (
    target.context_hint.start_line !== null &&
    target.context_hint.end_line !== null
  ) {
    return `${target.file} lines ${target.context_hint.start_line}-${target.context_hint.end_line}`;
  }

  if (target.context_hint.search_hint) {
    return `search ${target.context_hint.search_hint} in ${target.file}`;
  }

  return formatReadTargetLocation(target);
}

function buildStandardFixText(args: {
  bucket: GenericBucket;
  bucketLabel: string;
}): string | null {
  if (args.bucket.hint) {
    return args.bucket.hint;
  }

  const extended = findExtendedBucketSpec(args.bucket.reason);
  if (extended) {
    return extended.fix;
  }

  const envVar = args.bucket.reason.match(/^missing test env:\s+([A-Z][A-Z0-9_]{2,})$/)?.[1];
  if (envVar) {
    return `Set ${envVar} before rerunning the affected tests.`;
  }

  const missingModule = args.bucket.reason.match(/^missing module:\s+(.+)$/)?.[1];
  if (missingModule) {
    return `Install ${missingModule} and rerun the affected tests.`;
  }

  if (args.bucket.reason.startsWith("fixture guard:")) {
    return "Restore the missing fixture/setup guard and rerun the full suite at standard.";
  }

  if (args.bucket.reason.startsWith("db refused:")) {
    return "Fix the test database connectivity and rerun the full suite at standard.";
  }

  if (args.bucket.reason.startsWith("service unavailable:")) {
    return "Restore the dependency service or test double and rerun the full suite at standard.";
  }

  if (args.bucket.reason.startsWith("auth bypass absent:")) {
    return "Restore the test auth bypass setup and rerun the full suite at standard.";
  }

  if (args.bucket.reason.startsWith("unknown setup blocker:")) {
    return "Take one deeper sift pass or inspect the first anchored setup failure before rerunning.";
  }

  if (args.bucket.reason.startsWith("unknown failure family:")) {
    return "Take one deeper sift pass or inspect the first anchored failing test before rerunning.";
  }

  if (args.bucket.type === "contract_snapshot_drift") {
    return "Review the visible drift and regenerate the contract snapshots if the changes are intentional.";
  }

  if (args.bucket.type === "snapshot_mismatch") {
    return "Update the snapshots if these output changes are intentional, then rerun the full suite at standard.";
  }

  if (args.bucket.type === "assertion_failure") {
    return "Inspect the failing assertion and rerun the full suite at standard.";
  }

  if (args.bucket.type === "collection_failure") {
    return "Fix the collection/setup failure and rerun the full suite at standard.";
  }

  if (args.bucket.type === "runtime_failure") {
    return `Fix the visible ${args.bucketLabel} and rerun the full suite at standard.`;
  }

  return null;
}

function buildStandardBucketSupport(args: {
  bucket: GenericBucket;
  contractBucket: TestStatusDiagnoseBucket;
  readTarget?: TestStatusReadTarget;
}): StandardBucketSupport {
  return {
    headline: args.bucket.summaryLines[0]
      ? `- ${args.bucket.summaryLines[0]}`
      : renderBucketHeadline(args.contractBucket),
    firstConcreteSignalText:
      args.bucket.source === "unknown" ? args.bucket.summaryLines[1] ?? null : null,
    anchorText: buildStandardAnchorText(args.readTarget),
    fixText: buildStandardFixText({
      bucket: args.bucket,
      bucketLabel: args.contractBucket.label
    })
  };
}

function renderStandard(args: {
  analysis: TestStatusAnalysis;
  contract: TestStatusDiagnoseContract;
  buckets: GenericBucket[];
}): string {
  const lines = [...buildOutcomeLines(args.analysis), ...buildComparisonLines(args.contract)];
  if (args.contract.main_buckets.length > 0) {
    for (const bucket of args.contract.main_buckets.slice(0, 3)) {
      const rawBucket = args.buckets[bucket.bucket_index - 1];
      if (!rawBucket) {
        lines.push(renderBucketHeadline(bucket));
        continue;
      }

      const support = buildStandardBucketSupport({
        bucket: rawBucket,
        contractBucket: bucket,
        readTarget: args.contract.read_targets.find(
          (target) => target.bucket_index === bucket.bucket_index
        )
      });
      lines.push(support.headline);
      if (support.firstConcreteSignalText) {
        lines.push(`- ${support.firstConcreteSignalText}`);
      }
      if (support.anchorText) {
        lines.push(`- Anchor: ${support.anchorText}`);
      }
      if (support.fixText) {
        lines.push(`- Fix: ${support.fixText}`);
      }
    }
  }
  lines.push(buildDecisionLine(args.contract));
  lines.push(`- Next: ${args.contract.next_best_action.note}`);
  lines.push(buildStopSignal(args.contract));

  return lines.join("\n");
}

function renderFocused(args: {
  analysis: TestStatusAnalysis;
  contract: TestStatusDiagnoseContract;
  buckets: GenericBucket[];
}): string {
  const lines = [...buildOutcomeLines(args.analysis), ...buildComparisonLines(args.contract)];

  for (const bucket of args.contract.main_buckets) {
    const rawBucket = args.buckets[bucket.bucket_index - 1];
    lines.push(
      ...(rawBucket?.summaryLines.length
        ? rawBucket.summaryLines.map((line) => `- ${line}`)
        : [renderBucketHeadline(bucket)])
    );
    for (const evidence of bucket.evidence) {
      lines.push(`  - ${evidence}`);
    }
    if (rawBucket?.hint) {
      lines.push(`  - Hint: ${rawBucket.hint}`);
    }
  }

  lines.push(buildDecisionLine(args.contract));
  lines.push(`- Next: ${args.contract.next_best_action.note}`);
  lines.push(buildStopSignal(args.contract));
  return lines.join("\n");
}

function renderVerbose(args: {
  analysis: TestStatusAnalysis;
  contract: TestStatusDiagnoseContract;
  buckets: GenericBucket[];
}): string {
  const lines = [...buildOutcomeLines(args.analysis), ...buildComparisonLines(args.contract)];

  for (const bucket of args.contract.main_buckets) {
    const rawBucket = args.buckets[bucket.bucket_index - 1];
    lines.push(
      ...(rawBucket?.summaryLines.length
        ? rawBucket.summaryLines.map((line) => `- ${line}`)
        : [renderBucketHeadline(bucket)])
    );
    for (const item of rawBucket?.representativeItems ?? []) {
      lines.push(`  - ${item.label} -> ${item.reason}`);
    }
    if (bucket.mini_diff) {
      lines.push(`  - mini-diff: ${JSON.stringify(bucket.mini_diff)}`);
    }
    if (rawBucket?.hint) {
      lines.push(`  - Hint: ${rawBucket.hint}`);
    }
  }

  lines.push(buildDecisionLine(args.contract));
  lines.push(`- Next: ${args.contract.next_best_action.note}`);
  lines.push(buildStopSignal(args.contract));
  return lines.join("\n");
}

export function buildTestStatusDiagnoseContract(args: {
  input: string;
  analysis: TestStatusAnalysis;
  resolvedTests?: string[];
  remainingTests?: string[];
  providerBucketSupplements?: TestStatusProviderSupplement["bucket_supplements"];
  contractOverrides?: TestStatusContractOverrides;
}): TestStatusDecision {
  const heuristicBuckets = mergeBuckets(args.analysis);
  const preUnknownSimpleCollectionFailure =
    args.analysis.collectionErrorCount !== undefined &&
    args.analysis.collectionItems.length === 0 &&
    heuristicBuckets.length === 0 &&
    (args.providerBucketSupplements?.length ?? 0) === 0;
  const heuristicResiduals = buildCoverageResiduals({
    analysis: args.analysis,
    buckets: heuristicBuckets
  });
  const providerSupplementBuckets = buildProviderSupplementBuckets({
    supplements: args.providerBucketSupplements ?? [],
    remainingErrors: heuristicResiduals.remainingErrors,
    remainingFailed: heuristicResiduals.remainingFailed
  });
  const combinedBuckets = mergeBuckets(args.analysis, providerSupplementBuckets);
  const residuals = buildCoverageResiduals({
    analysis: args.analysis,
    buckets: combinedBuckets
  });
  const unknownBuckets = preUnknownSimpleCollectionFailure
    ? []
    : [
        buildUnknownBucket({
          analysis: args.analysis,
          kind: "error",
          count: residuals.remainingErrors
        }),
        buildUnknownBucket({
          analysis: args.analysis,
          kind: "failed",
          count: residuals.remainingFailed
        })
      ].filter((bucket): bucket is GenericBucket => Boolean(bucket));
  const buckets = prioritizeBuckets([...combinedBuckets, ...unknownBuckets]).slice(0, 3);
  const simpleCollectionFailure =
    args.analysis.collectionErrorCount !== undefined &&
    args.analysis.collectionItems.length === 0 &&
    buckets.length === 0;
  const dominantBucket =
    buckets
      .map((bucket, index) => ({
        bucket,
        index
      }))
      .sort((left, right) => {
        if (right.bucket.count !== left.bucket.count) {
          return right.bucket.count - left.bucket.count;
        }
        return right.bucket.confidence - left.bucket.confidence;
      })[0] ?? null;
  const hasUnknownBucket = buckets.some((bucket) => isUnknownBucket(bucket));
  const hasConcreteCoverage =
    args.analysis.failed === 0 && args.analysis.errors === 0
      ? true
      : residuals.remainingErrors === 0 && residuals.remainingFailed === 0;
  const diagnosisComplete =
    (args.analysis.failed === 0 && args.analysis.errors === 0 && args.analysis.passed > 0) ||
    simpleCollectionFailure ||
    (buckets.length > 0 &&
      hasConcreteCoverage &&
      !hasUnknownBucket &&
      (dominantBucket?.bucket.confidence ?? 0) >= 0.6);
  const rawNeeded = buckets.length === 0
    ? !(
        (args.analysis.failed === 0 &&
          args.analysis.errors === 0 &&
          args.analysis.passed > 0) ||
        simpleCollectionFailure
      )
    : !diagnosisComplete &&
      !hasUnknownBucket &&
      buckets.every((bucket) => bucket.confidence < 0.7);
  const dominantBlockerBucketIndex =
    dominantBucket && isDominantBlockerType(dominantBucket.bucket.type)
      ? dominantBucket.index + 1
      : null;
  const readTargets = buildReadTargets({
    buckets,
    dominantBucketIndex: dominantBlockerBucketIndex
  });
  const mainBuckets = buckets.map((bucket, index) => ({
    bucket_index: index + 1,
    label: labelForBucket(bucket),
    count: bucket.count,
    root_cause: bucket.reason,
    evidence: buildBucketEvidence(bucket),
    bucket_confidence: Number(bucket.confidence.toFixed(2)),
    root_cause_confidence: Number(rootCauseConfidenceFor(bucket).toFixed(2)),
    dominant: dominantBucket?.index === index,
    secondary_visible_despite_blocker:
      dominantBlockerBucketIndex !== null && dominantBlockerBucketIndex !== index + 1,
    mini_diff: extractMiniDiff(args.input, bucket)
  }));
  const resolvedTests = unique(args.resolvedTests ?? []);
  const remainingTests = unique(
    args.remainingTests ?? unique([...args.analysis.visibleErrorLabels, ...args.analysis.visibleFailedLabels])
  );

  let nextBestAction: TestStatusDiagnoseContract["next_best_action"];
  if (args.analysis.failed === 0 && args.analysis.errors === 0 && args.analysis.passed > 0) {
    nextBestAction = {
      code: "read_source_for_bucket",
      bucket_index: null,
      note: "No failing buckets remain."
    };
  } else if (simpleCollectionFailure) {
    nextBestAction = {
      code: "read_source_for_bucket",
      bucket_index: null,
      note: "Inspect the collection traceback or setup code next; the run failed before tests executed."
    };
  } else if (hasUnknownBucket) {
    nextBestAction = {
      code: "insufficient_signal",
      bucket_index: dominantBucket ? dominantBucket.index + 1 : null,
      note:
        "Take one deeper sift pass or inspect the first anchored failure before falling back to raw traceback."
    };
  } else if (!diagnosisComplete) {
    nextBestAction = {
      code: rawNeeded ? "read_raw_for_exact_traceback" : "insufficient_signal",
      bucket_index: dominantBucket ? dominantBucket.index + 1 : null,
      note: rawNeeded
        ? "Use focused or verbose detail, and read raw traceback only if exact stack lines are still needed."
        : "The visible output is not yet specific enough to diagnose reliably."
    };
  } else if (dominantBlockerBucketIndex !== null) {
    nextBestAction = {
      code: "fix_dominant_blocker",
      bucket_index: dominantBlockerBucketIndex,
      note:
        dominantBlockerBucketIndex === 1 && mainBuckets.some((bucket) => bucket.secondary_visible_despite_blocker)
          ? "Fix bucket 1 first, then rerun the full suite at standard. Secondary buckets are already visible behind it."
          : `Fix bucket ${dominantBlockerBucketIndex} first, then rerun the full suite at standard.`
    };
  } else {
    nextBestAction = {
      code: rawNeeded ? "read_raw_for_exact_traceback" : "read_source_for_bucket",
      bucket_index: mainBuckets[0]?.bucket_index ?? null,
      note: rawNeeded
        ? "Read raw traceback only if exact stack lines are required after the current diagnosis."
        : `Read the source or test code for bucket ${mainBuckets[0]?.bucket_index ?? 1} next.`
    };
  }

  const baseContract = {
    status: diagnosisComplete ? "ok" : "insufficient",
    diagnosis_complete: diagnosisComplete,
    raw_needed: rawNeeded,
    additional_source_read_likely_low_value: diagnosisComplete && !rawNeeded,
    read_raw_only_if: rawNeeded
      ? "you still need exact traceback lines after focused or verbose detail"
      : null,
    dominant_blocker_bucket_index: dominantBlockerBucketIndex,
    provider_used: false,
    provider_confidence: null,
    provider_failed: false,
    raw_slice_used: false,
    raw_slice_strategy: "none" as const,
    resolved_tests: resolvedTests,
    remaining_tests: remainingTests,
    main_buckets: mainBuckets,
    read_targets: readTargets,
    next_best_action: nextBestAction
  };
  const effectiveDiagnosisComplete =
    Boolean(args.contractOverrides?.diagnosis_complete ?? diagnosisComplete) && !hasUnknownBucket;
  const requestedDecision = args.contractOverrides?.decision;
  const effectiveDecision =
    hasUnknownBucket && requestedDecision && (requestedDecision === "stop" || requestedDecision === "read_source")
      ? "zoom"
      : requestedDecision;
  const effectiveNextBestAction = args.contractOverrides?.next_best_action ?? baseContract.next_best_action;
  const mergedContractWithoutDecision: Omit<TestStatusDiagnoseContract, "decision"> = {
    ...baseContract,
    ...args.contractOverrides,
    diagnosis_complete: effectiveDiagnosisComplete,
    status: effectiveDiagnosisComplete ? "ok" : "insufficient",
    next_best_action: {
      ...effectiveNextBestAction,
      note: buildConcreteNextNote({
        nextBestAction: effectiveNextBestAction,
        readTargets,
        hasSecondaryVisibleBucket: mainBuckets.some(
          (bucket) => bucket.secondary_visible_despite_blocker
        )
      })
    }
  };
  const contract = testStatusDiagnoseContractSchema.parse({
    ...mergedContractWithoutDecision,
    decision: effectiveDecision ?? deriveDecision(mergedContractWithoutDecision)
  }) as TestStatusDiagnoseContract;

  return {
    contract,
    standardText: renderStandard({
      analysis: args.analysis,
      contract,
      buckets
    }),
    focusedText: renderFocused({
      analysis: args.analysis,
      contract,
      buckets
    }),
    verboseText: renderVerbose({
      analysis: args.analysis,
      contract,
      buckets
    })
  };
}

export function buildTestStatusPublicDiagnoseContract(args: {
  contract: TestStatusDiagnoseContract;
  includeTestIds?: boolean;
  remainingSubsetAvailable?: boolean;
}): TestStatusPublicDiagnoseContract {
  const {
    resolved_tests,
    remaining_tests,
    ...rest
  } = args.contract;

  return testStatusPublicDiagnoseContractSchema.parse({
    ...rest,
    resolved_summary: buildTestTargetSummary(resolved_tests),
    remaining_summary: buildTestTargetSummary(remaining_tests),
    remaining_subset_available:
      Boolean(args.remainingSubsetAvailable) && remaining_tests.length > 0,
    ...(args.includeTestIds
      ? {
          resolved_tests,
          remaining_tests
        }
      : {})
  }) as TestStatusPublicDiagnoseContract;
}

export function buildTestStatusAnalysisContext(args: {
  contract: TestStatusDiagnoseContract;
  remainingSubsetAvailable?: boolean;
  includeTestIds?: boolean;
}): string {
  const publicContract = buildTestStatusPublicDiagnoseContract({
    contract: args.contract,
    includeTestIds: args.includeTestIds,
    remainingSubsetAvailable: args.remainingSubsetAvailable
  });
  const bucketLines =
    args.contract.main_buckets.length === 0
      ? ["- No failing buckets visible."]
      : args.contract.main_buckets.map(
          (bucket) =>
            `- Bucket ${bucket.bucket_index}: ${bucket.label}; count=${bucket.count}; root_cause=${bucket.root_cause}; dominant=${bucket.dominant}`
        );

  return [
    "Heuristic extract:",
    `- diagnosis_complete=${args.contract.diagnosis_complete}`,
    `- raw_needed=${args.contract.raw_needed}`,
    `- decision=${args.contract.decision}`,
    `- provider_used=${args.contract.provider_used}`,
    `- provider_failed=${args.contract.provider_failed}`,
    `- raw_slice_strategy=${args.contract.raw_slice_strategy}`,
    `- resolved_summary=${formatTargetSummary(publicContract.resolved_summary)}`,
    `- remaining_summary=${formatTargetSummary(publicContract.remaining_summary)}`,
    `- remaining_subset_available=${publicContract.remaining_subset_available}`,
    ...(args.includeTestIds && args.contract.resolved_tests.length > 0
      ? [`- resolved_tests=${args.contract.resolved_tests.join(", ")}`]
      : []),
    ...(args.includeTestIds && args.contract.remaining_tests.length > 0
      ? [`- remaining_tests=${args.contract.remaining_tests.join(", ")}`]
      : []),
    ...(args.contract.read_targets.length > 0
      ? args.contract.read_targets.map(
          (target) =>
            `- read_target[bucket=${target.bucket_index}]=${formatReadTargetLocation(target)} -> ${target.why}${target.context_hint.start_line !== null && target.context_hint.end_line !== null ? `; lines=${target.context_hint.start_line}-${target.context_hint.end_line}` : target.context_hint.search_hint ? `; search=${target.context_hint.search_hint}` : ""}`
        )
      : []),
    ...bucketLines,
    `- next_best_action=${args.contract.next_best_action.code}`
  ].join("\n");
}
