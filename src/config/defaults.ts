import type { SiftConfig } from "../types.js";

export const defaultConfig: SiftConfig = {
  provider: {
    provider: "openai",
    model: "gpt-5-nano",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    jsonResponseFormat: "auto",
    timeoutMs: 20_000,
    temperature: 0.1,
    maxOutputTokens: 400
  },
  input: {
    stripAnsi: true,
    redact: false,
    redactStrict: false,
    maxCaptureChars: 400_000,
    maxInputChars: 60_000,
    headChars: 20_000,
    tailChars: 20_000
  },
  runtime: {
    rawFallback: true,
    verbose: false
  },
  presets: {
    "test-status": {
      question: "Did the tests pass? If not, list only the failing tests or suites.",
      format: "bullets",
      policy: "test-status"
    },
    "audit-critical": {
      question:
        "Extract only high and critical vulnerabilities. Include package, severity, and a short remediation note.",
      format: "json",
      policy: "audit-critical",
      outputContract:
        '{"status":"ok|insufficient","vulnerabilities":[{"package":string,"severity":"critical|high","remediation":string}],"summary":string}'
    },
    "diff-summary": {
      question:
        "Summarize the code changes and mention any risky or high-impact areas.",
      format: "json",
      policy: "diff-summary",
      outputContract:
        '{"status":"ok|insufficient","answer":string,"evidence":string[],"risks":string[]}'
    },
    "build-failure": {
      question:
        "Identify the most likely root cause of the build failure and the first thing to fix.",
      format: "brief",
      policy: "build-failure"
    },
    "log-errors": {
      question: "Extract only the most relevant errors or failure signals.",
      format: "bullets",
      policy: "log-errors"
    },
    "typecheck-summary": {
      question:
        "Summarize the blocking typecheck failures. Group repeated errors by root cause and point to the first files or symbols to fix.",
      format: "bullets",
      policy: "typecheck-summary"
    },
    "lint-failures": {
      question:
        "Summarize the blocking lint failures. Group repeated rules, highlight the top offending files, and call out only failures that matter for fixing the run.",
      format: "bullets",
      policy: "lint-failures"
    },
    "infra-risk": {
      question:
        "Assess whether the infrastructure changes are risky and whether they look safe to apply.",
      format: "verdict",
      policy: "infra-risk"
    }
  }
};
