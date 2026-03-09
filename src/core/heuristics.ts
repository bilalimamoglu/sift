import type { PromptPolicyName } from "../types.js";

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
  input: string
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

  return null;
}
