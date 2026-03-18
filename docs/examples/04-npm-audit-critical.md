# Example: npm Audit Critical Findings

**Preset:** `audit-critical`
**Case ID:** `npm-audit-mixed-severity`
**Source type:** `synthetic-derived`

## Before

```text
# npm audit report

Project: platform-api
Workspace: services/api
Dependencies scanned: 2319

lodash  <4.17.21
Severity: critical
Prototype Pollution - https://github.com/advisories/GHSA-jf85-cpcp-j695

@babel/traverse  <7.23.2
Severity: critical
Code injection via malicious package - https://github.com/advisories/GHSA-67hx-6x53-jw92

semver  <7.5.2
Severity: high
tough-cookie  <4.1.3
Severity: high
node-fetch  <2.6.7
Severity: moderate
follow-redirects  <1.15.6
Severity: moderate

6 vulnerabilities (2 critical, 2 high, 2 moderate)
```

## After

```text
{
  "status": "ok",
  "vulnerabilities": [
    {
      "package": "lodash",
      "severity": "critical",
      "remediation": "Upgrade lodash to a patched version."
    },
    {
      "package": "@babel/traverse",
      "severity": "critical",
      "remediation": "Upgrade @babel/traverse to a patched version."
    },
    {
      "package": "semver",
      "severity": "high",
      "remediation": "Upgrade semver to a patched version."
    },
    {
      "package": "tough-cookie",
      "severity": "high",
      "remediation": "Upgrade tough-cookie to a patched version."
    }
  ],
  "summary": "4 high or critical vulnerabilities found in the provided input."
}
```

## Impact

- Raw: `1490` chars / `435` tokens
- Reduced: `669` chars / `168` tokens
- Reduction: `61.38%`

## Related Files

- Benchmark raw input: [benchmarks/cases/audit-critical/npm-audit-mixed-severity.raw.txt](../../benchmarks/cases/audit-critical/npm-audit-mixed-severity.raw.txt)
- Companion raw log: [examples/audit-critical/npm-audit-mixed-severity-full.raw.txt](../../examples/audit-critical/npm-audit-mixed-severity-full.raw.txt)
- Companion reduced output: [examples/audit-critical/npm-audit-mixed-severity-full.reduced.txt](../../examples/audit-critical/npm-audit-mixed-severity-full.reduced.txt)
