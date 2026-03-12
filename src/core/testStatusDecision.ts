import type {
  FailureBucket,
  FailureBucketType,
  TestStatusAnalysis
} from "./heuristics.js";

export type DiagnoseActionCode =
  | "fix_dominant_blocker"
  | "read_source_for_bucket"
  | "read_raw_for_exact_traceback"
  | "insufficient_signal";

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

export interface TestStatusDiagnoseContract {
  status: "ok" | "insufficient";
  diagnosis_complete: boolean;
  raw_needed: boolean;
  additional_source_read_likely_low_value: boolean;
  read_raw_only_if: string | null;
  dominant_blocker_bucket_index: number | null;
  resolved_tests: string[];
  remaining_tests: string[];
  main_buckets: TestStatusDiagnoseBucket[];
  next_best_action: {
    code: DiagnoseActionCode;
    bucket_index: number | null;
    note: string;
  };
}

export interface TestStatusDecision {
  contract: TestStatusDiagnoseContract;
  standardText: string;
  focusedText: string;
  verboseText: string;
}

export const TEST_STATUS_DIAGNOSE_JSON_CONTRACT =
  '{"status":"ok|insufficient","diagnosis_complete":boolean,"raw_needed":boolean,"additional_source_read_likely_low_value":boolean,"read_raw_only_if":string|null,"dominant_blocker_bucket_index":number|null,"resolved_tests":string[],"remaining_tests":string[],"main_buckets":[{"bucket_index":number,"label":string,"count":number,"root_cause":string,"evidence":string[],"bucket_confidence":number,"root_cause_confidence":number,"dominant":boolean,"secondary_visible_despite_blocker":boolean,"mini_diff":{"added_paths"?:number,"removed_models"?:number,"changed_task_mappings"?:number}|null}],"next_best_action":{"code":"fix_dominant_blocker|read_source_for_bucket|read_raw_for_exact_traceback|insufficient_signal","bucket_index":number|null,"note":string}}';

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
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function classifyGenericBucketType(reason: string): FailureBucketType {
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

function buildGenericBuckets(analysis: TestStatusAnalysis): GenericBucket[] {
  const buckets: GenericBucket[] = [];
  const grouped = new Map<string, GenericBucket>();

  const push = (reason: string, item: FailureBucket["representativeItems"][number]) => {
    const key = `${classifyGenericBucketType(reason)}:${reason}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
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
      confidence:
        reason.startsWith("assertion failed:") || /^[A-Z][A-Za-z]+(?:Error|Exception):/.test(reason)
          ? 0.74
          : 0.62,
      representativeItems: [item],
      entities: [],
      hint: undefined,
      overflowCount: 0,
      overflowLabel: "failing tests/modules"
    });
  };

  for (const item of [...analysis.collectionItems, ...analysis.inlineItems]) {
    push(item.reason, item);
  }

  for (const bucket of grouped.values()) {
    const title =
      bucket.type === "assertion_failure"
        ? "Assertion failures"
        : bucket.type === "import_dependency_failure"
          ? "Import/dependency failures"
          : bucket.type === "collection_failure"
            ? "Collection or fixture failures"
            : "Runtime failures";
    bucket.headline = `${title}: ${formatCount(bucket.count, "visible failure")} share ${bucket.reason}.`;
    bucket.summaryLines = [bucket.headline];
    bucket.overflowCount = Math.max(bucket.count - bucket.representativeItems.length, 0);
    buckets.push(bucket);
  }

  return buckets.sort((left, right) => right.count - left.count);
}

function mergeBuckets(analysis: TestStatusAnalysis): GenericBucket[] {
  const merged: GenericBucket[] = analysis.buckets.map((bucket) => ({
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
    overflowLabel: bucket.overflowLabel
  }));

  if (merged.length >= 3) {
    return merged;
  }

  const coveredLabels = new Set(
    merged.flatMap((bucket) => bucket.representativeItems.map((item) => item.label))
  );
  for (const bucket of buildGenericBuckets(analysis)) {
    const unseenItems = bucket.representativeItems.filter((item) => !coveredLabels.has(item.label));
    if (unseenItems.length === 0) {
      continue;
    }

    merged.push({
      ...bucket,
      count: Math.max(bucket.count, unseenItems.length),
      representativeItems: unseenItems
    });
    unseenItems.forEach((item) => coveredLabels.add(item.label));
    if (merged.length >= 3) {
      break;
    }
  }

  return merged.slice(0, 3);
}

function isDominantBlockerType(type: FailureBucketType): boolean {
  return (
    type === "shared_environment_blocker" ||
    type === "import_dependency_failure" ||
    type === "collection_failure"
  );
}

function labelForBucket(bucket: GenericBucket): string {
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
  if (bucket.type === "collection_failure") {
    return "collection failure";
  }
  if (bucket.type === "runtime_failure") {
    return "runtime failure";
  }
  return "unknown failure";
}

function rootCauseConfidenceFor(bucket: GenericBucket): number {
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

function renderStandard(args: {
  analysis: TestStatusAnalysis;
  contract: TestStatusDiagnoseContract;
  buckets: GenericBucket[];
}): string {
  if (
    args.contract.main_buckets.length === 0 &&
    (args.analysis.noTestsCollected ||
      args.analysis.collectionErrorCount !== undefined ||
      (args.analysis.failed === 0 && args.analysis.errors === 0 && args.analysis.passed > 0))
  ) {
    return buildOutcomeLines(args.analysis).join("\n");
  }

  const lines = [...buildOutcomeLines(args.analysis), ...buildComparisonLines(args.contract)];
  for (const bucket of args.contract.main_buckets.slice(0, 3)) {
    const rawBucket = args.buckets[bucket.bucket_index - 1];
    lines.push(
      ...(rawBucket?.summaryLines.length
        ? rawBucket.summaryLines.map((line) => `- ${line}`)
        : [renderBucketHeadline(bucket)])
    );
  }

  const evidence = args.contract.main_buckets.flatMap((bucket) => {
    const rawBucket = args.buckets[bucket.bucket_index - 1];
    if (rawBucket?.summaryLines.length && rawBucket.summaryLines.length > 1) {
      return [];
    }
    return bucket.evidence.map((value) => `- Evidence: ${value}`);
  });
  lines.push(...evidence.slice(0, 2));
  lines.push(
    ...args.buckets
      .map((bucket) => bucket.hint)
      .filter((value): value is string => Boolean(value))
      .slice(0, 2)
      .map((hint) => `- Hint: ${hint}`)
  );
  lines.push(`- Next: ${args.contract.next_best_action.note}`);
  lines.push(buildStopSignal(args.contract));

  return lines.join("\n");
}

function renderFocused(args: {
  analysis: TestStatusAnalysis;
  contract: TestStatusDiagnoseContract;
  buckets: GenericBucket[];
}): string {
  if (
    args.contract.main_buckets.length === 0 &&
    (args.analysis.noTestsCollected ||
      args.analysis.collectionErrorCount !== undefined ||
      (args.analysis.failed === 0 && args.analysis.errors === 0 && args.analysis.passed > 0))
  ) {
    return buildOutcomeLines(args.analysis).join("\n");
  }

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

  lines.push(`- Next: ${args.contract.next_best_action.note}`);
  lines.push(buildStopSignal(args.contract));
  return lines.join("\n");
}

function renderVerbose(args: {
  analysis: TestStatusAnalysis;
  contract: TestStatusDiagnoseContract;
  buckets: GenericBucket[];
}): string {
  if (
    args.contract.main_buckets.length === 0 &&
    (args.analysis.noTestsCollected ||
      args.analysis.collectionErrorCount !== undefined ||
      (args.analysis.failed === 0 && args.analysis.errors === 0 && args.analysis.passed > 0))
  ) {
    return buildOutcomeLines(args.analysis).join("\n");
  }

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

  lines.push(`- Next: ${args.contract.next_best_action.note}`);
  lines.push(buildStopSignal(args.contract));
  return lines.join("\n");
}

export function buildTestStatusDiagnoseContract(args: {
  input: string;
  analysis: TestStatusAnalysis;
  resolvedTests?: string[];
  remainingTests?: string[];
}): TestStatusDecision {
  const buckets = mergeBuckets(args.analysis);
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
  const diagnosisComplete =
    (args.analysis.failed === 0 && args.analysis.errors === 0 && args.analysis.passed > 0) ||
    simpleCollectionFailure ||
    (buckets.length > 0 && (dominantBucket?.bucket.confidence ?? 0) >= 0.7);
  const rawNeeded =
    buckets.length > 0
      ? buckets.every((bucket) => bucket.confidence < 0.7)
      : !(
          (args.analysis.failed === 0 &&
            args.analysis.errors === 0 &&
            args.analysis.passed > 0) ||
          simpleCollectionFailure
        );
  const dominantBlockerBucketIndex =
    dominantBucket && isDominantBlockerType(dominantBucket.bucket.type)
      ? dominantBucket.index + 1
      : null;
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

  const contract: TestStatusDiagnoseContract = {
    status: diagnosisComplete ? "ok" : "insufficient",
    diagnosis_complete: diagnosisComplete,
    raw_needed: rawNeeded,
    additional_source_read_likely_low_value: diagnosisComplete && !rawNeeded,
    read_raw_only_if: rawNeeded
      ? "you still need exact traceback lines after focused or verbose detail"
      : null,
    dominant_blocker_bucket_index: dominantBlockerBucketIndex,
    resolved_tests: resolvedTests,
    remaining_tests: remainingTests,
    main_buckets: mainBuckets,
    next_best_action: nextBestAction
  };

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

export function buildTestStatusAnalysisContext(
  contract: TestStatusDiagnoseContract
): string {
  const bucketLines =
    contract.main_buckets.length === 0
      ? ["- No failing buckets visible."]
      : contract.main_buckets.map(
          (bucket) =>
            `- Bucket ${bucket.bucket_index}: ${bucket.label}; count=${bucket.count}; root_cause=${bucket.root_cause}; dominant=${bucket.dominant}`
        );

  return [
    "Heuristic extract:",
    `- diagnosis_complete=${contract.diagnosis_complete}`,
    `- raw_needed=${contract.raw_needed}`,
    ...(contract.resolved_tests.length > 0
      ? [`- resolved_tests=${contract.resolved_tests.join(", ")}`]
      : []),
    ...(contract.remaining_tests.length > 0
      ? [`- remaining_tests=${contract.remaining_tests.join(", ")}`]
      : []),
    ...bucketLines,
    `- next_best_action=${contract.next_best_action.code}`
  ].join("\n");
}
