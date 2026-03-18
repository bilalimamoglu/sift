import { join } from "node:path";

export type BenchmarkPreset =
  | "typecheck-summary"
  | "lint-failures"
  | "build-failure"
  | "audit-critical"
  | "infra-risk";

export type SourceType =
  | "official-doc"
  | "public-ci-derived"
  | "public-issue-derived"
  | "synthetic-derived";

export type ExpectedReductionKind =
  | "grouped-errors"
  | "rule-summary"
  | "brief-root-cause"
  | "security-findings"
  | "risk-verdict";

export interface BenchmarkCase {
  id: string;
  preset: BenchmarkPreset;
  relativeRawPath: string;
  title: string;
  description: string;
  sourceType: SourceType;
  capturedAt: string;
  expectedReductionKind: ExpectedReductionKind;
  expectedSnippets: string[];
  expectedHeuristicFires: boolean;
  docsSlug?: string;
}

export const CASES_DIR = join(import.meta.dirname, "cases");

export function resolveCaseRawPath(relativeRawPath: string): string {
  return join(CASES_DIR, relativeRawPath);
}

export const benchmarkCases: BenchmarkCase[] = [
  {
    id: "ts-wall-mixed",
    preset: "typecheck-summary",
    relativeRawPath: "typecheck-summary/ts-wall-mixed.raw.txt",
    title: "TypeScript error wall with stable top code groups",
    description:
      "A 96-error mixed-code wall across 8 files designed so the top grouped TS codes are deterministic.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "grouped-errors",
    expectedSnippets: [
      "Typecheck failed: 96 errors in 8 files.",
      "TS2322 (type mismatch): 20 occurrences",
      "TS2345 (argument type mismatch): 17 occurrences"
    ],
    expectedHeuristicFires: true,
    docsSlug: "01-tsc-type-wall"
  },
  {
    id: "ts-module-not-found",
    preset: "typecheck-summary",
    relativeRawPath: "typecheck-summary/ts-module-not-found.raw.txt",
    title: "TypeScript missing-module concentration",
    description: "A focused TS2307 case with 8 missing-module errors across 5 files.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "grouped-errors",
    expectedSnippets: [
      "Typecheck failed: 8 errors in 5 files.",
      "TS2307 (cannot find module): 8 occurrences"
    ],
    expectedHeuristicFires: true
  },
  {
    id: "ts-single-file-errors",
    preset: "typecheck-summary",
    relativeRawPath: "typecheck-summary/ts-single-file-errors.raw.txt",
    title: "TypeScript single-file focused failure",
    description: "A narrow 12-error case where every failure belongs to src/utils/transform.ts.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "grouped-errors",
    expectedSnippets: [
      "Typecheck failed: 12 errors in 1 file.",
      "src/utils/transform.ts"
    ],
    expectedHeuristicFires: true
  },
  {
    id: "eslint-mixed-rules",
    preset: "lint-failures",
    relativeRawPath: "lint-failures/eslint-mixed-rules.raw.txt",
    title: "ESLint stylish mixed rule summary",
    description:
      "A 96-problem stylish report across 4 files with stable top error groups and fixable hints.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "rule-summary",
    expectedSnippets: [
      "Lint failed: 96 problems (60 errors, 36 warnings). 18 problems potentially fixable with --fix.",
      "no-unused-vars: 28 errors",
      "react/react-in-jsx-scope: 18 errors"
    ],
    expectedHeuristicFires: true,
    docsSlug: "02-eslint-stylish"
  },
  {
    id: "eslint-single-file-dense",
    preset: "lint-failures",
    relativeRawPath: "lint-failures/eslint-single-file-dense.raw.txt",
    title: "ESLint dense single-file report",
    description:
      "A 22-problem stylish report concentrated in one file to stress stable rule grouping.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "rule-summary",
    expectedSnippets: [
      "Lint failed: 22 problems (15 errors, 7 warnings).",
      "no-unused-vars: 8 errors",
      "react/react-in-jsx-scope: 5 errors"
    ],
    expectedHeuristicFires: true
  },
  {
    id: "eslint-warnings-only",
    preset: "lint-failures",
    relativeRawPath: "lint-failures/eslint-warnings-only.raw.txt",
    title: "ESLint warnings-only output",
    description: "A zero-error stylish report that should still reduce into a useful warnings summary.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "rule-summary",
    expectedSnippets: [
      "No lint errors visible: 8 warnings.",
      "no-console: 4 warnings",
      "prefer-const: 4 warnings"
    ],
    expectedHeuristicFires: true
  },
  {
    id: "esbuild-missing-module",
    preset: "build-failure",
    relativeRawPath: "build-failure/esbuild-missing-module.raw.txt",
    title: "esbuild missing module root cause",
    description:
      "A concise esbuild [ERROR] case with a file/line anchor and a module-resolution fix hint.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "brief-root-cause",
    expectedSnippets: [
      "react-query",
      "src/hooks/usePosts.ts:3",
      "Install the missing package or fix the import path."
    ],
    expectedHeuristicFires: true,
    docsSlug: "03-esbuild-build-failure"
  },
  {
    id: "webpack-type-error",
    preset: "build-failure",
    relativeRawPath: "build-failure/webpack-type-error.raw.txt",
    title: "webpack TypeScript type error",
    description:
      "A webpack ERROR in block where the first concrete line is a stable type error message.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "brief-root-cause",
    expectedSnippets: [
      "userSlice.ts",
      "Type 'string' is not assignable to type 'UserStatus'",
      "Fix the type error at the indicated location."
    ],
    expectedHeuristicFires: true
  },
  {
    id: "vite-syntax-error",
    preset: "build-failure",
    relativeRawPath: "build-failure/vite-syntax-error.raw.txt",
    title: "Vite/esbuild syntax error root cause",
    description:
      "A Vite-wrapped esbuild syntax error with a stable file/line anchor and syntax fix hint.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "brief-root-cause",
    expectedSnippets: [
      "parser.ts:18",
      "Expected \";\" but found \"{\"",
      "Fix the syntax error at the indicated location."
    ],
    expectedHeuristicFires: true
  },
  {
    id: "npm-audit-critical-only",
    preset: "audit-critical",
    relativeRawPath: "audit-critical/npm-audit-critical-only.raw.txt",
    title: "Compact audit output with only critical findings",
    description: "Two compact critical vulnerability lines in the current parser-friendly shape.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "security-findings",
    expectedSnippets: [
      "\"status\": \"ok\"",
      "\"package\": \"lodash\"",
      "\"severity\": \"critical\"",
      "2 high or critical vulnerabilities found in the provided input."
    ],
    expectedHeuristicFires: true
  },
  {
    id: "npm-audit-mixed-severity",
    preset: "audit-critical",
    relativeRawPath: "audit-critical/npm-audit-mixed-severity.raw.txt",
    title: "Compact audit output with mixed critical/high/moderate severities",
    description:
      "Critical and high findings should be retained while moderate findings are ignored by the heuristic.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "security-findings",
    expectedSnippets: [
      "\"status\": \"ok\"",
      "\"package\": \"lodash\"",
      "\"package\": \"semver\"",
      "4 high or critical vulnerabilities found in the provided input."
    ],
    expectedHeuristicFires: true,
    docsSlug: "04-npm-audit-critical"
  },
  {
    id: "npm-audit-clean",
    preset: "audit-critical",
    relativeRawPath: "audit-critical/npm-audit-clean.raw.txt",
    title: "Explicitly clean audit output",
    description: "An explicit zero-vulnerabilities audit summary that should now reduce deterministically.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "security-findings",
    expectedSnippets: [
      "\"status\": \"ok\"",
      "\"vulnerabilities\": []",
      "No high or critical vulnerabilities found in the provided input."
    ],
    expectedHeuristicFires: true
  },
  {
    id: "tf-plan-destroy",
    preset: "infra-risk",
    relativeRawPath: "infra-risk/tf-plan-destroy.raw.txt",
    title: "Terraform plan with destructive changes",
    description: "A plan containing destroy actions and a destructive plan summary.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "risk-verdict",
    expectedSnippets: [
      "\"verdict\": \"fail\"",
      "Destructive or clearly risky infrastructure change signals are present.",
      "# aws_s3_bucket.uploads will be destroyed"
    ],
    expectedHeuristicFires: true,
    docsSlug: "05-terraform-destructive"
  },
  {
    id: "tf-plan-safe-additions",
    preset: "infra-risk",
    relativeRawPath: "infra-risk/tf-plan-safe-additions.raw.txt",
    title: "Terraform plan with safe additive changes",
    description: "A plan with only additions and an explicit zero-destroy summary.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "risk-verdict",
    expectedSnippets: [
      "\"verdict\": \"pass\"",
      "The provided input explicitly indicates zero destructive changes.",
      "0 to destroy"
    ],
    expectedHeuristicFires: true
  },
  {
    id: "tf-plan-mixed-risk",
    preset: "infra-risk",
    relativeRawPath: "infra-risk/tf-plan-mixed-risk.raw.txt",
    title: "Terraform plan with mixed change types but destructive risk",
    description: "A plan that mixes updates and creates with one destroy and should still fail.",
    sourceType: "synthetic-derived",
    capturedAt: "2025-01-01",
    expectedReductionKind: "risk-verdict",
    expectedSnippets: [
      "\"verdict\": \"fail\"",
      "Destructive or clearly risky infrastructure change signals are present.",
      "aws_sqs_queue.dead_letter will be destroyed"
    ],
    expectedHeuristicFires: true
  }
];
