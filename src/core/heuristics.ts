import type { DetailLevel, PromptPolicyName } from "../types.js";

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
}

interface FailureClassification {
  reason: string;
  group: string;
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

  for (const line of lines) {
    const collecting = line.match(/^_+\s+ERROR collecting\s+(.+?)\s+_+\s*$/);
    if (collecting) {
      if (currentLabel && pendingGenericReason) {
        pushFocusedFailureItem(
          items,
          {
            label: currentLabel,
            reason: pendingGenericReason.reason,
            group: pendingGenericReason.group
          }
        );
      }
      currentLabel = cleanFailureLabel(collecting[1]!);
      pendingGenericReason = null;
      continue;
    }

    if (!currentLabel) {
      continue;
    }

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

    pushFocusedFailureItem(
      items,
      {
        label: currentLabel,
        reason: classification.reason,
        group: classification.group
      }
    );
    currentLabel = null;
    pendingGenericReason = null;
  }

  if (currentLabel && pendingGenericReason) {
    pushFocusedFailureItem(
      items,
      {
        label: currentLabel,
        reason: pendingGenericReason.reason,
        group: pendingGenericReason.group
      }
    );
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

    const classification = classifyFailureReason(inlineFailure[3]!, {
      duringCollection: false
    });
    if (!classification) {
      continue;
    }

    pushFocusedFailureItem(
      items,
      {
        label: cleanFailureLabel(inlineFailure[2]!),
        reason: classification.reason,
        group: classification.group
      }
    );
  }

  return items;
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
  const importCollectionHits =
    countPattern(input, /ImportError while importing test module/gi) +
    countPattern(input, /^\s*_+\s+ERROR collecting\b/gim);
  const genericErrorTypes = collectUniqueMatches(
    input,
    /\b((?:Assertion|Import|Type|Value|Runtime|Reference|Key|Attribute)[A-Za-z]*Error)\b/gi,
    4
  );
  const bullets: string[] = [];

  if (
    (options.duringCollection && (importCollectionHits >= 2 || missingModuleHits >= 2)) ||
    (!options.duringCollection && missingModuleHits >= 2)
  ) {
    bullets.push(
      options.duringCollection
        ? "- Most failures are import/dependency errors during test collection."
        : "- Most failures are import/dependency errors."
    );
  }

  if (missingModules.length > 1) {
    bullets.push(`- Missing modules include ${missingModules.join(", ")}.`);
  } else if (missingModules.length === 1 && missingModuleHits >= 2) {
    bullets.push(`- Missing module repeated across failures: ${missingModules[0]}.`);
  }

  if (bullets.length < 2 && genericErrorTypes.length >= 2) {
    bullets.push(`- Repeated error types include ${genericErrorTypes.join(", ")}.`);
  }

  return bullets.slice(0, 2);
}

function testStatusHeuristic(input: string, detail: DetailLevel = "standard"): string | null {
  const normalized = input.trim();
  if (normalized === "") {
    return null;
  }

  const passed = getCount(input, "passed");
  const failed = getCount(input, "failed");
  const errors = Math.max(
    getCount(input, "errors"),
    getCount(input, "error")
  );
  const skipped = getCount(input, "skipped");
  const collectionErrors = input.match(/(\d+)\s+errors?\s+during collection/i);
  const noTestsCollected =
    /\bcollected\s+0\s+items\b/i.test(input) || /\bno tests ran\b/i.test(input);
  const interrupted =
    /\binterrupted\b/i.test(input) || /\bKeyboardInterrupt\b/i.test(input);
  const inlineItems = collectInlineFailureItems(input);

  if (collectionErrors) {
    const count = Number(collectionErrors[1]);
    const items = chooseStrongestFailureItems(collectCollectionFailureItems(input));

    if (detail === "verbose") {
      if (items.length > 0) {
        return [
          "- Tests did not complete.",
          `- ${formatCount(count, "error")} occurred during collection.`,
          ...formatVerboseFailureItems({
            items
          })
        ].join("\n");
      }
    }

    if (detail === "focused") {
      if (items.length > 0) {
        const groupedLines = formatFocusedFailureGroups({
          items,
          remainderLabel: "modules"
        });

        if (groupedLines.length > 0) {
          return [
            "- Tests did not complete.",
            `- ${formatCount(count, "error")} occurred during collection.`,
            ...groupedLines
          ].join("\n");
        }
      }
    }

    const causes = summarizeRepeatedTestCauses(input, {
      duringCollection: true
    });

    return [
      "- Tests did not complete.",
      `- ${formatCount(count, "error")} occurred during collection.`,
      ...causes
    ].join("\n");
  }

  if (noTestsCollected) {
    return ["- Tests did not run.", "- Collected 0 items."].join("\n");
  }

  if (interrupted && failed === 0 && errors === 0) {
    return "- Test run was interrupted.";
  }

  if (failed === 0 && errors === 0 && passed > 0) {
    const details = [formatCount(passed, "test")];
    if (skipped > 0) {
      details.push(formatCount(skipped, "skip"));
    }

    return [
      "- Tests passed.",
      `- ${details.join(", ")}.`
    ].join("\n");
  }

  if (failed > 0 || errors > 0 || inlineItems.length > 0) {
    const summarizedInlineItems = chooseStrongestFailureItems(inlineItems);

    if (detail === "verbose") {
      if (summarizedInlineItems.length > 0) {
        const detailLines = [];

        if (failed > 0) {
          detailLines.push(`- ${formatCount(failed, "test")} failed.`);
        }

        if (errors > 0) {
          detailLines.push(`- ${formatCount(errors, "error")} occurred.`);
        }

        return [
          "- Tests did not pass.",
          ...detailLines,
          ...formatVerboseFailureItems({
            items: summarizedInlineItems
          })
        ].join("\n");
      }
    }

    if (detail === "focused") {
      if (summarizedInlineItems.length > 0) {
        const detailLines = [];

        if (failed > 0) {
          detailLines.push(`- ${formatCount(failed, "test")} failed.`);
        }

        if (errors > 0) {
          detailLines.push(`- ${formatCount(errors, "error")} occurred.`);
        }

        return [
          "- Tests did not pass.",
          ...detailLines,
          ...formatFocusedFailureGroups({
            items: summarizedInlineItems,
            remainderLabel: "tests or modules"
          })
        ].join("\n");
      }
    }

    const detailLines = [];
    const causes = summarizeRepeatedTestCauses(input, {
      duringCollection: false
    });

    if (failed > 0) {
      detailLines.push(`- ${formatCount(failed, "test")} failed.`);
    }

    if (errors > 0) {
      detailLines.push(`- ${formatCount(errors, "error")} occurred.`);
    }

    const evidence = input
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /\b(FAILED|ERROR)\b/.test(line))
      .slice(0, 3)
      .map((line) => `- ${line}`);

    return ["- Tests did not pass.", ...detailLines, ...causes, ...evidence].join("\n");
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
