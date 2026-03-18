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

lodash: critical - Prototype Pollution (GHSA-jf85-cpcp-j695) - fix: npm audit fix
  Introduced via: request, webpack-dev-server

@babel/traverse: critical - Code injection via malicious package (GHSA-67hx-6x53-jw92)
  Introduced via: jest > @jest/core > @babel/traverse

semver: high - Regular Expression Denial of Service (GHSA-c2qf-rxjj-qqgw)
tough-cookie: high - Prototype Pollution (GHSA-72xf-g2v4-qvf3)
node-fetch: moderate - Exposure of Sensitive Information
follow-redirects: moderate - Improper Input Validation

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

- Raw: `1706` chars / `514` tokens
- Reduced: `669` chars / `168` tokens
- Reduction: `67.32%`

## Full Example

- Raw log: [npm-audit-mixed-severity-full.raw.txt](/Users/bilalimamoglu/repos/sift/examples/audit-critical/npm-audit-mixed-severity-full.raw.txt)
- Reduced output: [npm-audit-mixed-severity-full.reduced.txt](/Users/bilalimamoglu/repos/sift/examples/audit-critical/npm-audit-mixed-severity-full.reduced.txt)
