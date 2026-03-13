import type { DetailLevel, PromptPolicyName } from "../types.js";
import { buildTestStatusDiagnoseContract } from "./testStatusDecision.js";

const RISK_LINE_PATTERN =
  /(destroy|delete|drop|recreate|replace|revoke|deny|downtime|data loss|iam|network exposure)/i;
const ZERO_DESTRUCTIVE_SUMMARY_PATTERN =
  /\b0\s+to\s+(destroy|delete|drop|recreate|replace|revoke)\b/i;
const SAFE_LINE_PATTERN =
  /(no changes|up-to-date|up to date|no risky changes|safe to apply)/i;

function collectEvidence(input: string, matcher: RegExp, limit = 3): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && matcher.test(line))
    .slice(0, limit);
}

function inferSeverity(token: string): "critical" | "high" {
  return token.toLowerCase().includes("critical") ? "critical" : "high";
}

function inferPackage(line: string): string | null {
  const match = line.match(/^\s*([@a-z0-9._/-]+)\s*:/i);
  return match?.[1] ?? null;
}

function inferRemediation(pkg: string): string {
  return `Upgrade ${pkg} to a patched version.`;
}

function getCount(input: string, label: string): number {
  const matches = [...input.matchAll(new RegExp(`(\\d+)\\s+${label}`, "gi"))];
  const lastMatch = matches.at(-1);
  return lastMatch ? Number(lastMatch[1]) : 0;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countPattern(input: string, matcher: RegExp): number {
  return [...input.matchAll(matcher)].length;
}

function collectUniqueMatches(input: string, matcher: RegExp, limit = 6): string[] {
  const values: string[] = [];

  for (const match of input.matchAll(matcher)) {
    const candidate = match[1]?.trim();
    if (!candidate || values.includes(candidate)) {
      continue;
    }

    values.push(candidate);
    if (values.length >= limit) {
      break;
    }
  }

  return values;
}

interface FocusedFailureItem {
  label: string;
  reason: string;
  group: string;
  file: string | null;
  line: number | null;
  anchor_kind: "traceback" | "test_label" | "entity" | "none";
  anchor_confidence: number;
}

interface StatusFailureItem extends FocusedFailureItem {
  status: "failed" | "error";
}

interface FailureClassification {
  reason: string;
  group: string;
}

function emptyAnchor(): Pick<
  FocusedFailureItem,
  "file" | "line" | "anchor_kind" | "anchor_confidence"
> {
  return {
    file: null,
    line: null,
    anchor_kind: "none",
    anchor_confidence: 0
  };
}

function normalizeAnchorFile(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

function inferFileFromLabel(label: string): string | null {
  const candidate = cleanFailureLabel(label).split("::")[0]?.trim();
  if (!candidate) {
    return null;
  }

  if (!/[./\\]/.test(candidate) || !/\.[A-Za-z0-9]+$/.test(candidate)) {
    return null;
  }

  return normalizeAnchorFile(candidate);
}

function buildLabelAnchor(label: string): Pick<
  FocusedFailureItem,
  "file" | "line" | "anchor_kind" | "anchor_confidence"
> {
  const file = inferFileFromLabel(label);
  if (!file) {
    return emptyAnchor();
  }

  return {
    file,
    line: null,
    anchor_kind: "test_label",
    anchor_confidence: 0.72
  };
}

function parseObservedAnchor(
  line: string
): Pick<FocusedFailureItem, "file" | "line" | "anchor_kind" | "anchor_confidence"> | null {
  const normalized = line.trim();
  if (normalized.length === 0) {
    return null;
  }

  const fileWithLine =
    normalized.match(/^([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?:\s+in\b/) ??
    normalized.match(/^([^:\s][^:]*\.[A-Za-z0-9]+):(\d+)(?::\d+)?:\s+in\b/);
  if (fileWithLine) {
    return {
      file: normalizeAnchorFile(fileWithLine[1]!),
      line: Number(fileWithLine[2]),
      anchor_kind: "traceback",
      anchor_confidence: 1
    };
  }

  const pythonTraceback = normalized.match(/^File\s+"([^"]+)",\s+line\s+(\d+)/);
  if (pythonTraceback) {
    return {
      file: normalizeAnchorFile(pythonTraceback[1]!),
      line: Number(pythonTraceback[2]),
      anchor_kind: "traceback",
      anchor_confidence: 1
    };
  }

  const importModule = normalized.match(
    /ImportError while importing test module ['"]([^'"]+\.[A-Za-z0-9]+)['"]/i
  );
  if (importModule) {
    return {
      file: normalizeAnchorFile(importModule[1]!),
      line: null,
      anchor_kind: "traceback",
      anchor_confidence: 0.92
    };
  }

  return null;
}

function resolveAnchorForLabel(args: {
  label: string;
  observedAnchor: Pick<
    FocusedFailureItem,
    "file" | "line" | "anchor_kind" | "anchor_confidence"
  > | null;
}): Pick<FocusedFailureItem, "file" | "line" | "anchor_kind" | "anchor_confidence"> {
  return args.observedAnchor ?? buildLabelAnchor(args.label);
}

function cleanFailureLabel(label: string): string {
  return label.trim().replace(/^['"]|['"]$/g, "");
}

function isLowValueInternalReason(normalized: string): boolean {
  return (
    /^Hint:\s+make sure your test modules\/packages have valid Python names\.?$/i.test(
      normalized
    ) ||
    /^Traceback\b/i.test(normalized) ||
    /^return _bootstrap\._gcd_import/i.test(normalized) ||
    /(?:^|[/\\])(?:site-packages[/\\])?_pytest(?:[/\\]|$)/i.test(normalized) ||
    /(?:^|[/\\])importlib[/\\]__init__\.py:\d+:\s+in\s+import_module\b/i.test(
      normalized
    ) ||
    /\bpython\.py:\d+:\s+in\s+importtestmodule\b/i.test(normalized) ||
    /\bpython\.py:\d+:\s+in\s+import_path\b/i.test(normalized)
  );
}

function scoreFailureReason(reason: string): number {
  if (reason.startsWith("missing test env:")) {
    return 6;
  }

  if (reason.startsWith("missing module:")) {
    return 5;
  }

  if (reason.startsWith("assertion failed:")) {
    return 4;
  }

  if (/^[A-Z][A-Za-z]+(?:Error|Exception):/.test(reason)) {
    return 3;
  }

  if (reason === "import error during collection") {
    return 2;
  }

  return 1;
}

function extractEnvBlockerName(normalized: string): string | null {
  const directMatch = normalized.match(
    /\bDB-isolated tests require\s+([A-Z][A-Z0-9_]{2,})\b/
  );
  if (directMatch) {
    return directMatch[1]!;
  }

  const fallbackMatch = normalized.match(
    /\b([A-Z][A-Z0-9_]{2,})\b(?=[^.\n]*DB-isolated tests)/
  );
  if (fallbackMatch) {
    return fallbackMatch[1]!;
  }

  const leadingEnvMatch = normalized.match(
    /\b([A-Z][A-Z0-9_]{2,})\b(?=[^.\n]{0,80}\b(?:is\s+)?(?:missing|unset|not set|not configured|required)\b)/
  );
  if (leadingEnvMatch) {
    return leadingEnvMatch[1]!;
  }

  const trailingEnvMatch = normalized.match(
    /\b(?:missing|unset|not set|not configured|required)\b[^.\n]{0,80}\b([A-Z][A-Z0-9_]{2,})\b/
  );
  if (trailingEnvMatch) {
    return trailingEnvMatch[1]!;
  }

  const validationEnvMatch = normalized.match(
    /\bValidationError\b[^.\n]{0,120}\b([A-Z][A-Z0-9_]{2,})\b/
  );
  return validationEnvMatch?.[1] ?? null;
}

function classifyFailureReason(
  line: string,
  options: {
    duringCollection: boolean;
  }
): FailureClassification | null {
  const normalized = line.trim().replace(/^[A-Z]\s+/, "");
  if (normalized.length === 0) {
    return null;
  }

  if (isLowValueInternalReason(normalized)) {
    return null;
  }

  if (
    /^([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):\d+(?::\d+)?:\s+in\b/.test(normalized) ||
    /^([^:\s][^:]*\.[A-Za-z0-9]+):\d+(?::\d+)?:\s+in\b/.test(normalized) ||
    /^File\s+"[^"]+",\s+line\s+\d+/.test(normalized)
  ) {
    return null;
  }

  const envBlocker = extractEnvBlockerName(normalized);
  if (envBlocker) {
    return {
      reason: `missing test env: ${envBlocker}`,
      group: "DB-backed tests are blocked by missing test environment configuration"
    };
  }

  const missingEnv = normalized.match(
    /\b(?:environment variable|env(?:ironment)? var(?:iable)?|missing required env(?:ironment)? variable)\s+([A-Z][A-Z0-9_]{2,})\b/
  );
  if (missingEnv) {
    return {
      reason: `missing test env: ${missingEnv[1]}`,
      group: "tests are blocked by missing environment configuration"
    };
  }

  const keyErrorEnv = normalized.match(/KeyError:\s*['"]([A-Z][A-Z0-9_]{2,})['"]/);
  if (keyErrorEnv) {
    return {
      reason: `missing test env: ${keyErrorEnv[1]}`,
      group: "tests are blocked by missing environment configuration"
    };
  }

  const fixtureGuard = normalized.match(
    /(?:FixtureLookupError|fixture guard|requires fixture)\b[^A-Za-z0-9_'-]*([a-z_][a-z0-9_]*)?/i
  );
  if (fixtureGuard) {
    return {
      reason: `fixture guard: ${fixtureGuard[1] ?? "required fixture unavailable"}`.trim(),
      group: "fixture guards or setup gates"
    };
  }

  if (
    /(ECONNREFUSED|ConnectionRefusedError|connection refused|could not connect to server)/i.test(
      normalized
    ) &&
    /(postgres|database|db|5432)/i.test(normalized)
  ) {
    return {
      reason: "db refused: database connection was refused",
      group: "database connectivity failures"
    };
  }

  if (/(ECONNREFUSED|ConnectionRefusedError|connection refused)/i.test(normalized)) {
    return {
      reason: "service unavailable: dependency connection was refused",
      group: "service availability failures"
    };
  }

  if (/(503\b|service unavailable|temporarily unavailable)/i.test(normalized)) {
    return {
      reason: "service unavailable: dependency service is unavailable",
      group: "service availability failures"
    };
  }

  if (
    /(auth bypass|test auth|bypass token)/i.test(normalized) &&
    /(missing|absent|not configured|not set|unavailable)/i.test(normalized)
  ) {
    return {
      reason: "auth bypass absent: test auth bypass is missing",
      group: "authentication test setup failures"
    };
  }

  const pythonMissingModule = normalized.match(
    /ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/i
  );
  if (pythonMissingModule) {
    return {
      reason: `missing module: ${pythonMissingModule[1]}`,
      group: options.duringCollection
        ? "import/dependency errors during collection"
        : "missing dependency/module errors"
    };
  }

  const nodeMissingModule = normalized.match(/Cannot find module ['"]([^'"]+)['"]/i);
  if (nodeMissingModule) {
    return {
      reason: `missing module: ${nodeMissingModule[1]}`,
      group: options.duringCollection
        ? "import/dependency errors during collection"
        : "missing dependency/module errors"
    };
  }

  const assertionFailure = normalized.match(/AssertionError:\s*(.+)$/i);
  if (assertionFailure) {
    return {
      reason: `assertion failed: ${assertionFailure[1]}`.slice(0, 120),
      group: "assertion failures"
    };
  }

  const genericError = normalized.match(/\b([A-Z][A-Za-z]+(?:Error|Exception)):\s*(.+)$/);
  if (genericError) {
    const errorType = genericError[1];
    return {
      reason: `${errorType}: ${genericError[2]}`.slice(0, 120),
      group:
        options.duringCollection && errorType === "ImportError"
          ? "import/dependency errors during collection"
          : `${errorType} failures`
    };
  }

  if (/ImportError while importing test module/i.test(normalized)) {
    return {
      reason: "import error during collection",
      group: "import/dependency errors during collection"
    };
  }

  if (!/[A-Za-z]/.test(normalized)) {
    return null;
  }

  return {
    reason: normalized.slice(0, 120),
    group: options.duringCollection ? "collection/import errors" : "other failures"
  };
}

function pushFocusedFailureItem(items: FocusedFailureItem[], candidate: FocusedFailureItem): void {
  if (items.some((item) => item.label === candidate.label && item.reason === candidate.reason)) {
    return;
  }

  items.push(candidate);
}

function chooseStrongestFailureItems(items: FocusedFailureItem[]): FocusedFailureItem[] {
  const strongest = new Map<string, FocusedFailureItem>();
  const order: string[] = [];

  for (const item of items) {
    const existing = strongest.get(item.label);
    if (!existing) {
      strongest.set(item.label, item);
      order.push(item.label);
      continue;
    }

    if (scoreFailureReason(item.reason) > scoreFailureReason(existing.reason)) {
      strongest.set(item.label, item);
    }
  }

  return order.map((label) => strongest.get(label)!);
}

function collectCollectionFailureItems(input: string): FocusedFailureItem[] {
  const items: FocusedFailureItem[] = [];
  const lines = input.split("\n");
  let currentLabel: string | null = null;
  let pendingGenericReason: FailureClassification | null = null;
  let currentAnchor: Pick<
    FocusedFailureItem,
    "file" | "line" | "anchor_kind" | "anchor_confidence"
  > | null = null;

  for (const line of lines) {
    const collecting = line.match(/^_+\s+ERROR collecting\s+(.+?)\s+_+\s*$/);
    if (collecting) {
      if (currentLabel && pendingGenericReason) {
        const anchor = resolveAnchorForLabel({
          label: currentLabel,
          observedAnchor: currentAnchor
        });
        pushFocusedFailureItem(items, {
          label: currentLabel,
          reason: pendingGenericReason.reason,
          group: pendingGenericReason.group,
          ...anchor
        });
      }
      currentLabel = cleanFailureLabel(collecting[1]!);
      pendingGenericReason = null;
      currentAnchor = null;
      continue;
    }

    if (!currentLabel) {
      continue;
    }

    currentAnchor = parseObservedAnchor(line) ?? currentAnchor;

    const classification = classifyFailureReason(line, {
      duringCollection: true
    });
    if (!classification) {
      continue;
    }

    if (classification.reason === "import error during collection") {
      pendingGenericReason = classification;
      continue;
    }

    const anchor = resolveAnchorForLabel({
      label: currentLabel,
      observedAnchor: currentAnchor
    });
    pushFocusedFailureItem(items, {
      label: currentLabel,
      reason: classification.reason,
      group: classification.group,
      ...anchor
    });
    currentLabel = null;
    pendingGenericReason = null;
    currentAnchor = null;
  }

  if (currentLabel && pendingGenericReason) {
    const anchor = resolveAnchorForLabel({
      label: currentLabel,
      observedAnchor: currentAnchor
    });
    pushFocusedFailureItem(items, {
      label: currentLabel,
      reason: pendingGenericReason.reason,
      group: pendingGenericReason.group,
      ...anchor
    });
  }

  return items;
}

function collectInlineFailureItems(input: string): FocusedFailureItem[] {
  const items: FocusedFailureItem[] = [];

  for (const line of input.split("\n")) {
    const inlineFailure = line.match(/^(FAILED|ERROR)\s+(.+?)\s+-\s+(.+)$/);
    if (!inlineFailure) {
      continue;
    }

    const cleanedLabel = cleanFailureLabel(inlineFailure[2]!);
    if (!cleanedLabel) {
      continue;
    }

    const classification = classifyFailureReason(inlineFailure[3]!, {
      duringCollection: false
    });
    if (!classification) {
      continue;
    }

    pushFocusedFailureItem(items, {
      label: cleanedLabel,
      reason: classification.reason,
      group: classification.group,
      ...resolveAnchorForLabel({
        label: cleanedLabel,
        observedAnchor: parseObservedAnchor(inlineFailure[3]!)
      })
    });
  }

  return items;
}

function collectInlineFailureItemsWithStatus(input: string): StatusFailureItem[] {
  const items: StatusFailureItem[] = [];

  for (const line of input.split("\n")) {
    const inlineFailure = line.match(/^(FAILED|ERROR)\s+(.+?)(?:\s+-\s+(.+))?$/);
    if (!inlineFailure) {
      continue;
    }

    const cleanedLabel = cleanFailureLabel(inlineFailure[2]!);
    if (!cleanedLabel) {
      continue;
    }

    const details = inlineFailure[3]?.trim();
    if (!details) {
      continue;
    }

    const classification = classifyFailureReason(details, {
      duringCollection: false
    });
    if (!classification) {
      continue;
    }

    items.push({
      label: cleanedLabel,
      reason: classification.reason,
      group: classification.group,
      status: inlineFailure[1] === "FAILED" ? "failed" : "error",
      ...resolveAnchorForLabel({
        label: cleanedLabel,
        observedAnchor: parseObservedAnchor(details)
      })
    });
  }

  return items;
}

function collectStandaloneErrorClassifications(input: string): FailureClassification[] {
  const classifications: FailureClassification[] = [];

  for (const line of input.split("\n")) {
    const standalone = line.match(/^\s*E\s+(.+)$/);
    if (!standalone) {
      continue;
    }

    const classification = classifyFailureReason(standalone[1]!, {
      duringCollection: false
    });
    if (!classification || classification.reason === "import error during collection") {
      continue;
    }

    classifications.push(classification);
  }

  return classifications;
}

function chooseStrongestStatusFailureItems(items: StatusFailureItem[]): StatusFailureItem[] {
  const strongest = new Map<string, StatusFailureItem>();
  const order: string[] = [];

  for (const item of items) {
    const key = `${item.status}:${item.label}`;
    const existing = strongest.get(key);
    if (!existing) {
      strongest.set(key, item);
      order.push(key);
      continue;
    }

    if (scoreFailureReason(item.reason) > scoreFailureReason(existing.reason)) {
      strongest.set(key, item);
    }
  }

  return order.map((key) => strongest.get(key)!);
}

function formatFocusedFailureGroups(args: {
  items: FocusedFailureItem[];
  maxGroups?: number;
  maxPerGroup?: number;
  remainderLabel: string;
}): string[] {
  const maxGroups = args.maxGroups ?? 3;
  const maxPerGroup = args.maxPerGroup ?? 6;
  const grouped = new Map<string, FocusedFailureItem[]>();

  for (const item of args.items) {
    const entries = grouped.get(item.group) ?? [];
    entries.push(item);
    grouped.set(item.group, entries);
  }

  const lines: string[] = [];
  const visibleGroups = [...grouped.entries()].slice(0, maxGroups);

  for (const [group, entries] of visibleGroups) {
    lines.push(`- ${group}`);
    for (const item of entries.slice(0, maxPerGroup)) {
      lines.push(`  - ${item.label} -> ${item.reason}`);
    }

    const remaining = entries.length - Math.min(entries.length, maxPerGroup);
    if (remaining > 0) {
      lines.push(`  - and ${remaining} more failing ${args.remainderLabel}`);
    }
  }

  const hiddenGroups = grouped.size - visibleGroups.length;
  if (hiddenGroups > 0) {
    lines.push(`- and ${hiddenGroups} more error group${hiddenGroups === 1 ? "" : "s"}`);
  }

  return lines;
}

function formatVerboseFailureItems(args: { items: FocusedFailureItem[] }): string[] {
  return chooseStrongestFailureItems(args.items).map(
    (item) => `- ${item.label} -> ${item.reason}`
  );
}

function summarizeRepeatedTestCauses(
  input: string,
  options: {
    duringCollection: boolean;
  }
): string[] {
  const pythonMissingModules = collectUniqueMatches(
    input,
    /ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/gi
  );
  const nodeMissingModules = collectUniqueMatches(
    input,
    /Cannot find module ['"]([^'"]+)['"]/gi
  );
  const missingModules = [...pythonMissingModules];

  for (const moduleName of nodeMissingModules) {
    if (!missingModules.includes(moduleName)) {
      missingModules.push(moduleName);
    }
  }

  const missingModuleHits =
    countPattern(
      input,
      /ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/gi
    ) + countPattern(input, /Cannot find module ['"]([^'"]+)['"]/gi);
  const envBlockers: string[] = [];
  let envBlockerHits = 0;

  for (const line of input.split("\n")) {
    const envBlocker = extractEnvBlockerName(line.trim().replace(/^[A-Z]\s+/, ""));
    if (!envBlocker) {
      continue;
    }

    envBlockerHits += 1;
    if (!envBlockers.includes(envBlocker) && envBlockers.length < 4) {
      envBlockers.push(envBlocker);
    }
  }
  const importCollectionHits =
    countPattern(input, /ImportError while importing test module/gi) +
    countPattern(input, /^\s*_+\s+ERROR collecting\b/gim);
  const genericErrorTypes = collectUniqueMatches(
    input,
    /\b((?:Assertion|Import|Type|Value|Runtime|Reference|Key|Attribute)[A-Za-z]*Error)\b/gi,
    4
  );
  const bullets: string[] = [];

  if (envBlockers.length > 0 && envBlockerHits >= 2) {
    bullets.push(`- Shared test environment blocker detected: ${envBlockers.join(", ")}.`);
  }

  if (
    bullets.length < 2 &&
    ((options.duringCollection && (importCollectionHits >= 2 || missingModuleHits >= 2)) ||
      (!options.duringCollection && missingModuleHits >= 2))
  ) {
    bullets.push(
      options.duringCollection
        ? "- Most failures are import/dependency errors during test collection."
        : "- Most failures are import/dependency errors."
    );
  }

  if (bullets.length < 2) {
    if (missingModules.length > 1) {
      bullets.push(`- Missing modules include ${missingModules.join(", ")}.`);
    } else if (missingModules.length === 1 && missingModuleHits >= 2) {
      bullets.push(`- Missing module repeated across failures: ${missingModules[0]}.`);
    }
  }

  if (bullets.length < 2 && genericErrorTypes.length >= 2) {
    bullets.push(`- Repeated error types include ${genericErrorTypes.join(", ")}.`);
  }

  return bullets.slice(0, 2);
}

interface VisibleFailureLabel {
  label: string;
  status: "failed" | "error";
}

export type FailureBucketType =
  | "shared_environment_blocker"
  | "fixture_guard_failure"
  | "service_unavailable"
  | "db_connection_failure"
  | "auth_bypass_absent"
  | "contract_snapshot_drift"
  | "import_dependency_failure"
  | "collection_failure"
  | "assertion_failure"
  | "runtime_failure"
  | "interrupted_run"
  | "no_tests_collected"
  | "unknown_failure";

export interface FailureBucket {
  type: FailureBucketType;
  headline: string;
  countVisible: number;
  countClaimed?: number;
  reason: string;
  representativeItems: FocusedFailureItem[];
  entities: string[];
  hint?: string;
  confidence: number;
  summaryLines: string[];
  overflowCount: number;
  overflowLabel: string;
}

export interface TestStatusAnalysis {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  noTestsCollected: boolean;
  interrupted: boolean;
  collectionErrorCount?: number;
  inlineItems: FocusedFailureItem[];
  collectionItems: FocusedFailureItem[];
  visibleErrorLabels: string[];
  visibleFailedLabels: string[];
  visibleErrorItems: StatusFailureItem[];
  buckets: FailureBucket[];
}

interface ContractDriftEntities {
  apiPaths: string[];
  modelIds: string[];
  taskKeys: string[];
  snapshotKeys: string[];
}

function collectFailureLabels(input: string): VisibleFailureLabel[] {
  const labels: VisibleFailureLabel[] = [];
  const seen = new Set<string>();

  const pushLabel = (label: string, status: "failed" | "error") => {
    const cleaned = cleanFailureLabel(label);
    if (!cleaned) {
      return;
    }

    const key = `${status}:${cleaned}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    labels.push({
      label: cleaned,
      status
    });
  };

  for (const line of input.split("\n")) {
    const progress = line.match(
      /^(tests\/.+?)(?:\s+<-\s+\S+)?\s+(FAILED|ERROR)\s+\[[^\]]+\]\s*$/
    );
    if (progress) {
      pushLabel(progress[1]!, progress[2] === "FAILED" ? "failed" : "error");
      continue;
    }

    const summary = line.match(/^(FAILED|ERROR)\s+(.+?)(?:\s+-\s+.*)?$/);
    if (summary) {
      pushLabel(summary[2]!, summary[1] === "FAILED" ? "failed" : "error");
    }
  }

  return labels;
}

function buildFailureCountLine(args: { failed: number; errors: number }): string | null {
  if (args.failed > 0 && args.errors > 0) {
    return `- ${formatCount(args.failed, "test")} failed. ${formatCount(args.errors, "error")} occurred.`;
  }

  if (args.failed > 0) {
    return `- ${formatCount(args.failed, "test")} failed.`;
  }

  if (args.errors > 0) {
    return `- ${formatCount(args.errors, "error")} occurred.`;
  }

  return null;
}

function classifyBucketTypeFromReason(reason: string): FailureBucketType {
  if (reason.startsWith("missing test env:")) {
    return "shared_environment_blocker";
  }

  if (reason.startsWith("fixture guard:")) {
    return "fixture_guard_failure";
  }

  if (reason.startsWith("service unavailable:")) {
    return "service_unavailable";
  }

  if (reason.startsWith("db refused:")) {
    return "db_connection_failure";
  }

  if (reason.startsWith("auth bypass absent:")) {
    return "auth_bypass_absent";
  }

  if (reason.startsWith("missing module:")) {
    return "import_dependency_failure";
  }

  if (reason.startsWith("assertion failed:")) {
    return "assertion_failure";
  }

  if (/^RuntimeError:|^[A-Z][A-Za-z]+(?:Error|Exception):/.test(reason)) {
    return "runtime_failure";
  }

  return "unknown_failure";
}

function synthesizeSharedBlockerBucket(args: {
  input: string;
  errors: number;
  visibleErrorItems: StatusFailureItem[];
  errorStatusLabels: string[];
}): FailureBucket | null {
  if (args.errors === 0) {
    return null;
  }

  const visibleReasonGroups = new Map<
    string,
    {
      count: number;
      group: string;
      items: StatusFailureItem[];
    }
  >();

  for (const item of args.visibleErrorItems) {
    const entry = visibleReasonGroups.get(item.reason);
    if (entry) {
      entry.count += 1;
      entry.items.push(item);
      continue;
    }

    visibleReasonGroups.set(item.reason, {
      count: 1,
      group: item.group,
      items: [item]
    });
  }

  const top = [...visibleReasonGroups.entries()]
    .filter(([, entry]) => entry.count >= 3)
    .sort((left, right) => right[1].count - left[1].count)[0];

  const standaloneReasonGroups = new Map<
    string,
    {
      count: number;
      group: string;
    }
  >();

  for (const classification of collectStandaloneErrorClassifications(args.input)) {
    const entry = standaloneReasonGroups.get(classification.reason);
    if (entry) {
      entry.count += 1;
      continue;
    }

    standaloneReasonGroups.set(classification.reason, {
      count: 1,
      group: classification.group
    });
  }

  const standaloneTop = [...standaloneReasonGroups.entries()]
    .filter(([, entry]) => entry.count >= 3)
    .sort((left, right) => right[1].count - left[1].count)[0];

  const visibleTopReason = top?.[0];
  const visibleTopStats = top?.[1];
  const standaloneTopReason = standaloneTop?.[0];
  const chosenReason =
    visibleTopReason && standaloneTopReason
      ? standaloneReasonGroups.get(standaloneTopReason)!.count > visibleTopStats!.count
        ? standaloneTopReason
        : visibleTopReason
      : visibleTopReason ?? standaloneTopReason;
  const singleEnvBlockerItem =
    !chosenReason &&
    args.visibleErrorItems.length === 1 &&
    args.visibleErrorItems[0]!.reason.startsWith("missing test env:")
      ? args.visibleErrorItems[0]
      : null;
  const effectiveReason = chosenReason ?? singleEnvBlockerItem?.reason;

  if (!effectiveReason || effectiveReason === "import error during collection") {
    return null;
  }

  const visibleStats = visibleReasonGroups.get(effectiveReason);
  const standaloneStats = standaloneReasonGroups.get(effectiveReason);
  const resolvedStats = (visibleStats ?? standaloneStats)!;
  const bucketType = classifyBucketTypeFromReason(effectiveReason);
  const countVisible = resolvedStats.count;

  const visibleReasonsAreUniform =
    args.visibleErrorItems.length === 0 ||
    args.visibleErrorItems.every((item) => item.reason === effectiveReason);
  const canClaimAllErrors =
    (args.errorStatusLabels.length >= 3 || Boolean(singleEnvBlockerItem)) &&
    visibleReasonsAreUniform &&
    args.errors >= countVisible;
  const countClaimed = canClaimAllErrors ? args.errors : undefined;
  const countText = countClaimed ?? countVisible;
  const atLeastPrefix = countClaimed ? "" : "At least ";
  const group = resolvedStats.group;
  const representativeItems =
    visibleStats?.items.slice(0, 4).map((item) => ({
      label: item.label,
      reason: effectiveReason,
      group,
      file: item.file,
      line: item.line,
      anchor_kind: item.anchor_kind,
      anchor_confidence: item.anchor_confidence
    })) ??
    args.errorStatusLabels.slice(0, 4).map((label) => ({
      label,
      reason: effectiveReason,
      group,
      ...buildLabelAnchor(label)
    }));
  const envVar = effectiveReason.match(/^missing test env:\s+([A-Z][A-Z0-9_]{2,})$/)?.[1];
  let hint: string | undefined;
  if (envVar) {
    hint = `Set ${envVar} (or pass --pgtest-dsn) before rerunning DB-isolated tests.`;
  } else if (effectiveReason.startsWith("fixture guard:")) {
    hint = "Unblock the required fixture or setup guard before rerunning the affected tests.";
  } else if (effectiveReason.startsWith("db refused:")) {
    hint = "Start the expected test database or fix the DSN before rerunning DB-backed tests.";
  } else if (effectiveReason.startsWith("service unavailable:")) {
    hint = "Restore the unavailable service dependency before rerunning the affected tests.";
  } else if (effectiveReason.startsWith("auth bypass absent:")) {
    hint = "Configure the expected auth bypass or test auth fixture before rerunning the affected tests.";
  } else if (effectiveReason.startsWith("missing module:")) {
    hint = "Install the missing dependency and rerun the affected tests.";
  }

  let headline: string;
  if (envVar) {
    headline = `Shared blocker: ${atLeastPrefix}${countText} errors require ${envVar} for DB-isolated tests.`;
  } else if (effectiveReason.startsWith("fixture guard:")) {
    headline = `Shared blocker: ${atLeastPrefix}${countText} errors are gated by the same fixture/setup guard.`;
  } else if (effectiveReason.startsWith("db refused:")) {
    headline = `Shared blocker: ${atLeastPrefix}${countText} errors are caused by refused database connections.`;
  } else if (effectiveReason.startsWith("service unavailable:")) {
    headline = `Shared blocker: ${atLeastPrefix}${countText} errors are caused by an unavailable service dependency.`;
  } else if (effectiveReason.startsWith("auth bypass absent:")) {
    headline = `Shared blocker: ${atLeastPrefix}${countText} errors are caused by missing auth bypass setup.`;
  } else if (effectiveReason.startsWith("missing module:")) {
    const moduleName = effectiveReason.replace("missing module:", "").trim();
    headline = `Shared blocker: ${atLeastPrefix}${countText} errors are caused by missing module ${moduleName}.`;
  } else {
    headline = `Shared blocker: ${atLeastPrefix}${countText} errors share ${effectiveReason}.`;
  }

  return {
    type: bucketType,
    headline,
    countVisible,
    countClaimed,
    reason: effectiveReason,
    representativeItems,
    entities: envVar ? [envVar] : [],
    hint,
    confidence: countClaimed ? 0.95 : 0.75,
    summaryLines: [headline],
    overflowCount: Math.max((countClaimed ?? countVisible) - representativeItems.length, 0),
    overflowLabel: "failing tests/modules"
  };
}

function synthesizeImportDependencyBucket(args: {
  errors: number;
  visibleErrorItems: StatusFailureItem[];
}): FailureBucket | null {
  if (args.errors === 0) {
    return null;
  }

  const importItems = args.visibleErrorItems.filter((item) => item.reason.startsWith("missing module:"));
  if (importItems.length < 2) {
    return null;
  }

  const allVisibleErrorsAreImportRelated =
    args.visibleErrorItems.length > 0 &&
    args.visibleErrorItems.every((item) => item.reason.startsWith("missing module:"));
  const countClaimed =
    allVisibleErrorsAreImportRelated && importItems.length >= 2 && args.errors >= importItems.length
      ? args.errors
      : undefined;
  const modules = Array.from(
    new Set(
      importItems
        .map((item) => item.reason.replace("missing module:", "").trim())
        .filter(Boolean)
    )
  ).slice(0, 6);
  const headlineCount = countClaimed ?? importItems.length;
  const headline = countClaimed
    ? `Import/dependency blocker: ${headlineCount} errors are caused by missing dependencies during test collection.`
    : `Import/dependency blocker: at least ${headlineCount} visible errors are caused by missing dependencies during test collection.`;
  const summaryLines = [headline];

  if (modules.length > 0) {
    summaryLines.push(`Missing modules include ${modules.join(", ")}.`);
  }

  return {
    type: "import_dependency_failure",
    headline,
    countVisible: importItems.length,
    countClaimed,
    reason: "missing dependencies during test collection",
    representativeItems: importItems.slice(0, 4).map((item) => ({
      label: item.label,
      reason: item.reason,
      group: item.group,
      file: item.file,
      line: item.line,
      anchor_kind: item.anchor_kind,
      anchor_confidence: item.anchor_confidence
    })),
    entities: modules,
    hint:
      modules.length === 1
        ? `Install ${modules[0]} and rerun the affected tests.`
        : "Install the missing dependencies and rerun the affected tests.",
    confidence: countClaimed ? 0.95 : 0.8,
    summaryLines,
    overflowCount: Math.max((countClaimed ?? importItems.length) - Math.min(importItems.length, 4), 0),
    overflowLabel: "failing tests/modules"
  };
}

function isContractDriftLabel(label: string): boolean {
  return /(freeze|snapshot|contract|manifest|openapi|golden)/i.test(label);
}

function looksLikeTaskKey(value: string): boolean {
  return /^[a-z]+(?:_[a-z0-9]+)+$/i.test(value) && !value.startsWith("/api/");
}

function looksLikeModelId(value: string): boolean {
  return !value.startsWith("/api/") && /^[a-z0-9][a-z0-9._/-]*-[a-z0-9._-]+$/i.test(value);
}

function extractContractDriftEntities(input: string): ContractDriftEntities {
  const apiPaths: string[] = [];
  const taskKeys: string[] = [];
  const modelIds: string[] = [];
  const snapshotKeys: string[] = [];

  for (const line of input.split("\n")) {
    const diffPathMatch = line.match(/^\s*(?:E\s+)?[+-]\s+'(\/api\/[^']+)'/);
    if (diffPathMatch) {
      const candidatePath = diffPathMatch[1]!.trim();
      if (candidatePath && !apiPaths.includes(candidatePath) && apiPaths.length < 6) {
        apiPaths.push(candidatePath);
      }
    }

    const diffMatch = line.match(/^\s*(?:E\s+)?[+-]\s+'([^']+)'[,]?\s*$/);
    if (!diffMatch) {
      continue;
    }

    const candidate = diffMatch[1]!.trim();
    if (!candidate) {
      continue;
    }

    if (candidate.startsWith("/api/")) {
      continue;
    }

    if (looksLikeModelId(candidate)) {
      if (!modelIds.includes(candidate) && modelIds.length < 6) {
        modelIds.push(candidate);
      }
      continue;
    }

    if (looksLikeTaskKey(candidate)) {
      if (!taskKeys.includes(candidate) && taskKeys.length < 6) {
        taskKeys.push(candidate);
      }
      continue;
    }

    if (!snapshotKeys.includes(candidate) && snapshotKeys.length < 6) {
      snapshotKeys.push(candidate);
    }
  }

  if (apiPaths.length === 0) {
    apiPaths.push(
      ...collectUniqueMatches(input, /['"](\/api\/[A-Za-z0-9_./{}:-]+)['"]/g, 6)
    );
  }

  return {
    apiPaths,
    modelIds,
    taskKeys,
    snapshotKeys
  };
}

function buildContractRepresentativeReason(args: {
  label: string;
  entities: ContractDriftEntities;
  usedPaths: Set<string>;
  usedModels: Set<string>;
}): string {
  if (/openapi/i.test(args.label) && args.entities.apiPaths.length > 0) {
    const nextPath =
      args.entities.apiPaths.find((path) => !args.usedPaths.has(path)) ??
      args.entities.apiPaths[0]!;
    args.usedPaths.add(nextPath);
    return `added path: ${nextPath}`;
  }

  if (/(feature|task|manifest|snapshot)/i.test(args.label) && args.entities.modelIds.length > 0) {
    const nextModel =
      args.entities.modelIds.find((modelId) => !args.usedModels.has(modelId)) ??
      args.entities.modelIds[0]!;
    args.usedModels.add(nextModel);
    return `removed model: ${nextModel}`;
  }

  if (args.entities.snapshotKeys.length > 0) {
    return `snapshot content changed: ${args.entities.snapshotKeys[0]}`;
  }

  return "snapshot content changed";
}

function synthesizeContractDriftBucket(args: {
  input: string;
  visibleFailedLabels: string[];
}): FailureBucket | null {
  const contractLabels = args.visibleFailedLabels.filter(isContractDriftLabel);
  if (contractLabels.length === 0) {
    return null;
  }

  const entities = extractContractDriftEntities(args.input);
  const usedPaths = new Set<string>();
  const usedModels = new Set<string>();
  const representativeItems = contractLabels.slice(0, 4).map((label) => ({
    label,
    reason: buildContractRepresentativeReason({
      label,
      entities,
      usedPaths,
      usedModels
    }),
    group: "contract drift",
    ...buildLabelAnchor(label)
  }));
  const summaryLines = [
    `Contract drift: ${formatCount(contractLabels.length, "freeze test")} ${contractLabels.length === 1 ? "is" : "are"} out of sync with current API/model state.`
  ];

  if (entities.apiPaths.length > 0 && entities.modelIds.length > 0) {
    summaryLines.push(
      `Contract drift includes ${formatCount(entities.apiPaths.length, "added API path")} and removed model ids such as ${entities.modelIds
        .slice(0, 3)
        .join(", ")}.`
    );
  } else if (entities.apiPaths.length > 0) {
    summaryLines.push(
      `OpenAPI drift includes ${formatCount(entities.apiPaths.length, "added API path")}.`
    );
  } else if (entities.modelIds.length > 0) {
    summaryLines.push(
      `Snapshot drift includes removed model ids such as ${entities.modelIds.slice(0, 3).join(", ")}.`
    );
  }

  const explicitCommand = args.input.match(/python\s+scripts\/update_contract_snapshots\.py/);
  const hint = explicitCommand
    ? `If these changes are intentional, run ${explicitCommand[0]} and rerun the freeze tests.`
    : "If these API/model changes are intentional, regenerate the contract snapshots and rerun the freeze tests.";

  return {
    type: "contract_snapshot_drift",
    headline: summaryLines[0]!,
    countVisible: contractLabels.length,
    countClaimed: contractLabels.length,
    reason: "freeze snapshots are out of sync with current API/model state",
    representativeItems,
    entities: [...entities.apiPaths, ...entities.modelIds, ...entities.taskKeys, ...entities.snapshotKeys].slice(0, 6),
    hint,
    confidence: entities.apiPaths.length > 0 || entities.modelIds.length > 0 ? 0.95 : 0.7,
    summaryLines,
    overflowCount: Math.max(
      [...entities.apiPaths, ...entities.modelIds, ...entities.taskKeys, ...entities.snapshotKeys]
        .slice(0, 6).length - representativeItems.length,
      0
    ),
    overflowLabel: "changed entities"
  };
}

export function analyzeTestStatus(input: string): TestStatusAnalysis {
  const passed = getCount(input, "passed");
  const failed = getCount(input, "failed");
  const errors = Math.max(getCount(input, "errors"), getCount(input, "error"));
  const skipped = getCount(input, "skipped");
  const collectionErrors = input.match(/(\d+)\s+errors?\s+during collection/i);
  const noTestsCollected =
    /\bcollected\s+0\s+items\b/i.test(input) || /\bno tests ran\b/i.test(input);
  const interrupted =
    /\binterrupted\b/i.test(input) || /\bKeyboardInterrupt\b/i.test(input);
  const collectionItems = chooseStrongestFailureItems(collectCollectionFailureItems(input));
  const inlineItems = chooseStrongestFailureItems(collectInlineFailureItems(input));
  const visibleErrorItems = chooseStrongestStatusFailureItems([
    ...collectionItems.map((item) => ({
      ...item,
      status: "error" as const
    })),
    ...collectInlineFailureItemsWithStatus(input).filter((item) => item.status === "error")
  ]);
  const labels = collectFailureLabels(input);
  const visibleErrorLabels = labels
    .filter((item) => item.status === "error")
    .map((item) => item.label);
  const visibleFailedLabels = labels
    .filter((item) => item.status === "failed")
    .map((item) => item.label);
  const buckets: FailureBucket[] = [];

  const sharedBlocker = synthesizeSharedBlockerBucket({
    input,
    errors,
    visibleErrorItems,
    errorStatusLabels: visibleErrorLabels
  });
  if (sharedBlocker) {
    buckets.push(sharedBlocker);
  }

  if (!sharedBlocker) {
    const importDependencyBucket = synthesizeImportDependencyBucket({
      errors,
      visibleErrorItems
    });
    if (importDependencyBucket) {
      buckets.push(importDependencyBucket);
    }
  }

  const contractDrift = synthesizeContractDriftBucket({
    input,
    visibleFailedLabels
  });
  if (contractDrift) {
    buckets.push(contractDrift);
  }

  return {
    passed,
    failed,
    errors,
    skipped,
    noTestsCollected,
    interrupted,
    collectionErrorCount: collectionErrors ? Number(collectionErrors[1]) : undefined,
    inlineItems,
    collectionItems,
    visibleErrorLabels,
    visibleFailedLabels,
    visibleErrorItems,
    buckets
  };
}

function dedupeLines(lines: string[]): string[] {
  const unique: string[] = [];

  for (const line of lines) {
    if (!unique.includes(line)) {
      unique.push(line);
    }
  }

  return unique;
}

function buildTestStatusHints(buckets: FailureBucket[]): string[] {
  return dedupeLines(
    buckets
      .filter((bucket) => bucket.confidence >= 0.7 && bucket.hint)
      .map((bucket) => `- Hint: ${bucket.hint}`)
  ).slice(0, 2);
}

function formatBucketFocused(bucket: FailureBucket): string[] {
  const lines = [`- ${bucket.headline}`];
  const visibleItems = bucket.representativeItems.slice(0, 4);

  for (const item of visibleItems) {
    lines.push(`  - ${item.label} -> ${item.reason}`);
  }

  const remaining = bucket.overflowCount;
  if (remaining > 0) {
    lines.push(`  - and ${remaining} more ${bucket.overflowLabel}`);
  }

  return lines;
}

function formatBucketVerbose(bucket: FailureBucket): string[] {
  const lines = [`- ${bucket.headline}`];

  for (const item of bucket.representativeItems) {
    lines.push(`  - ${item.label} -> ${item.reason}`);
  }

  return lines;
}

function buildLegacyFocusedOutput(args: {
  collectionItems: FocusedFailureItem[];
  inlineItems: FocusedFailureItem[];
  failed: number;
  errors: number;
  collectionCount?: number;
}): string | null {
  if (args.collectionCount && args.collectionItems.length > 0) {
    const groupedLines = formatFocusedFailureGroups({
      items: args.collectionItems,
      remainderLabel: "modules"
    });

    if (groupedLines.length > 0) {
      return [
        "- Tests did not complete.",
        `- ${formatCount(args.collectionCount, "error")} occurred during collection.`,
        ...groupedLines
      ].join("\n");
    }
  }

  if (args.inlineItems.length > 0) {
    const detailLines = [];

    if (args.failed > 0) {
      detailLines.push(`- ${formatCount(args.failed, "test")} failed.`);
    }

    if (args.errors > 0) {
      detailLines.push(`- ${formatCount(args.errors, "error")} occurred.`);
    }

    return [
      "- Tests did not pass.",
      ...detailLines,
      ...formatFocusedFailureGroups({
        items: args.inlineItems,
        remainderLabel: "tests or modules"
      })
    ].join("\n");
  }

  return null;
}

function buildLegacyVerboseOutput(args: {
  collectionItems: FocusedFailureItem[];
  inlineItems: FocusedFailureItem[];
  failed: number;
  errors: number;
  collectionCount?: number;
}): string | null {
  if (args.collectionCount && args.collectionItems.length > 0) {
    return [
      "- Tests did not complete.",
      `- ${formatCount(args.collectionCount, "error")} occurred during collection.`,
      ...formatVerboseFailureItems({
        items: args.collectionItems
      })
    ].join("\n");
  }

  if (args.inlineItems.length > 0) {
    const detailLines = [];

    if (args.failed > 0) {
      detailLines.push(`- ${formatCount(args.failed, "test")} failed.`);
    }

    if (args.errors > 0) {
      detailLines.push(`- ${formatCount(args.errors, "error")} occurred.`);
    }

    return [
      "- Tests did not pass.",
      ...detailLines,
      ...formatVerboseFailureItems({
        items: args.inlineItems
      })
    ].join("\n");
  }

  return null;
}

function formatStandardTestStatus(input: string, analysis: TestStatusAnalysis): string {
  const lines = [
    analysis.collectionErrorCount && analysis.failed === 0
      ? "- Tests did not complete."
      : "- Tests did not pass."
  ];
  if (analysis.collectionErrorCount && analysis.failed === 0) {
    lines.push(`- ${formatCount(analysis.collectionErrorCount, "error")} occurred during collection.`);
  } else {
    const countLine = buildFailureCountLine({
      failed: analysis.failed,
      errors: analysis.errors
    });
    if (countLine) {
      lines.push(countLine);
    }
  }

  const summaryLines = analysis.buckets.flatMap((bucket) => bucket.summaryLines);
  lines.push(...summaryLines.slice(0, 3).map((line) => `- ${line}`.replace(/^- - /, "- ")));

  if (analysis.collectionErrorCount && summaryLines.length === 0) {
    const causes = summarizeRepeatedTestCauses(input, {
      duringCollection: true
    });
    lines.push(...causes);
  } else if (summaryLines.length === 0) {
    const causes = summarizeRepeatedTestCauses(input, {
      duringCollection: false
    });
    lines.push(...causes);

    const evidence = input
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /\b(FAILED|ERROR)\b/.test(line))
      .slice(0, 3)
      .map((line) => `- ${line}`);
    lines.push(...evidence);
  }

  lines.push(...buildTestStatusHints(analysis.buckets));
  return dedupeLines(lines).join("\n");
}

function formatFocusedTestStatus(input: string, analysis: TestStatusAnalysis): string | null {
  if (analysis.buckets.length === 0) {
    return buildLegacyFocusedOutput({
      collectionItems: analysis.collectionItems,
      inlineItems: analysis.inlineItems,
      failed: analysis.failed,
      errors: analysis.errors,
      collectionCount: analysis.collectionErrorCount
    });
  }

  const lines = [
    analysis.collectionErrorCount && analysis.failed === 0
      ? "- Tests did not complete."
      : "- Tests did not pass."
  ];
  if (analysis.collectionErrorCount && analysis.failed === 0) {
    lines.push(`- ${formatCount(analysis.collectionErrorCount, "error")} occurred during collection.`);
  } else {
    const countLine = buildFailureCountLine({
      failed: analysis.failed,
      errors: analysis.errors
    });
    if (countLine) {
      lines.push(countLine);
    }
  }

  for (const bucket of analysis.buckets) {
    lines.push(...formatBucketFocused(bucket));
  }

  lines.push(...buildTestStatusHints(analysis.buckets));
  return dedupeLines(lines).join("\n");
}

function formatVerboseTestStatus(input: string, analysis: TestStatusAnalysis): string | null {
  if (analysis.buckets.length === 0) {
    return buildLegacyVerboseOutput({
      collectionItems: analysis.collectionItems,
      inlineItems: analysis.inlineItems,
      failed: analysis.failed,
      errors: analysis.errors,
      collectionCount: analysis.collectionErrorCount
    });
  }

  const lines = [
    analysis.collectionErrorCount && analysis.failed === 0
      ? "- Tests did not complete."
      : "- Tests did not pass."
  ];
  if (analysis.collectionErrorCount && analysis.failed === 0) {
    lines.push(`- ${formatCount(analysis.collectionErrorCount, "error")} occurred during collection.`);
  } else {
    const countLine = buildFailureCountLine({
      failed: analysis.failed,
      errors: analysis.errors
    });
    if (countLine) {
      lines.push(countLine);
    }
  }

  for (const bucket of analysis.buckets) {
    lines.push(...formatBucketVerbose(bucket));
  }

  lines.push(...buildTestStatusHints(analysis.buckets));
  return dedupeLines(lines).join("\n");
}

function testStatusHeuristic(input: string, detail: DetailLevel = "standard"): string | null {
  const normalized = input.trim();
  if (normalized === "") {
    return null;
  }

  const analysis = analyzeTestStatus(input);

  if (analysis.collectionErrorCount) {
    if (analysis.collectionItems.length > 0 || analysis.buckets.length > 0) {
      const decision = buildTestStatusDiagnoseContract({
        input,
        analysis
      });

      if (detail === "verbose") {
        return decision.verboseText;
      }

      if (detail === "focused") {
        return decision.focusedText;
      }

      return decision.standardText;
    }

    return [
      "- Tests did not complete.",
      `- ${formatCount(analysis.collectionErrorCount, "error")} occurred during collection.`,
      ...summarizeRepeatedTestCauses(input, {
        duringCollection: true
      })
    ].join("\n");
  }

  if (analysis.noTestsCollected) {
    return ["- Tests did not run.", "- Collected 0 items."].join("\n");
  }

  if (analysis.interrupted && analysis.failed === 0 && analysis.errors === 0) {
    return "- Test run was interrupted.";
  }

  if (analysis.failed === 0 && analysis.errors === 0 && analysis.passed > 0) {
    const details = [formatCount(analysis.passed, "test")];
    if (analysis.skipped > 0) {
      details.push(formatCount(analysis.skipped, "skip"));
    }

    return ["- Tests passed.", `- ${details.join(", ")}.`].join("\n");
  }

  if (analysis.failed > 0 || analysis.errors > 0 || analysis.inlineItems.length > 0 || analysis.buckets.length > 0) {
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    if (detail === "verbose") {
      return decision.verboseText;
    }

    if (detail === "focused") {
      return decision.focusedText;
    }

    return decision.standardText;
  }

  return null;
}


function auditCriticalHeuristic(input: string): string | null {
  const vulnerabilities = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (!/\b(critical|high)\b/i.test(line)) {
        return null;
      }

      const pkg = inferPackage(line);
      if (!pkg) {
        return null;
      }

      return {
        package: pkg,
        severity: inferSeverity(line),
        remediation: inferRemediation(pkg)
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (vulnerabilities.length === 0) {
    return null;
  }

  const firstVulnerability = vulnerabilities[0]!;

  return JSON.stringify(
    {
      status: "ok",
      vulnerabilities,
      summary:
        vulnerabilities.length === 1
          ? `One ${firstVulnerability.severity} vulnerability found in ${firstVulnerability.package}.`
          : `${vulnerabilities.length} high or critical vulnerabilities found in the provided input.`
    },
    null,
    2
  );
}

function infraRiskHeuristic(input: string): string | null {
  const zeroDestructiveEvidence = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && ZERO_DESTRUCTIVE_SUMMARY_PATTERN.test(line))
    .slice(0, 3);
  const riskEvidence = input
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        RISK_LINE_PATTERN.test(line) &&
        !ZERO_DESTRUCTIVE_SUMMARY_PATTERN.test(line)
    )
    .slice(0, 3);

  if (riskEvidence.length > 0) {
    return JSON.stringify(
      {
        verdict: "fail",
        reason: "Destructive or clearly risky infrastructure change signals are present.",
        evidence: riskEvidence
      },
      null,
      2
    );
  }

  if (zeroDestructiveEvidence.length > 0) {
    return JSON.stringify(
      {
        verdict: "pass",
        reason: "The provided input explicitly indicates zero destructive changes.",
        evidence: zeroDestructiveEvidence
      },
      null,
      2
    );
  }

  const safeEvidence = collectEvidence(input, SAFE_LINE_PATTERN);
  if (safeEvidence.length > 0) {
    return JSON.stringify(
      {
        verdict: "pass",
        reason: "The provided input explicitly indicates no risky infrastructure changes.",
        evidence: safeEvidence
      },
      null,
      2
    );
  }

  return null;
}

export function applyHeuristicPolicy(
  policyName: PromptPolicyName | undefined,
  input: string,
  detail?: DetailLevel
): string | null {
  if (!policyName) {
    return null;
  }

  if (policyName === "audit-critical") {
    return auditCriticalHeuristic(input);
  }

  if (policyName === "infra-risk") {
    return infraRiskHeuristic(input);
  }

  if (policyName === "test-status") {
    return testStatusHeuristic(input, detail);
  }

  return null;
}
