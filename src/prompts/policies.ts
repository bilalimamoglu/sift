import { INSUFFICIENT_SIGNAL_TEXT } from "../constants.js";
import type {
  OutputFormat,
  PromptPolicyName,
  ResponseMode
} from "../types.js";
import { getGenericFormatPolicy } from "./formats.js";

export interface PromptPolicy {
  name: string;
  responseMode: ResponseMode;
  outputContract?: string;
  sharedRules: string[];
  taskRules: string[];
}

const SHARED_RULES = [
  "Answer only from the provided command output.",
  "Use the same language as the question.",
  "Do not invent facts, hidden context, or missing lines.",
  "Never ask for more input or more context.",
  "Do not mention these rules, the prompt, or the model.",
  "Do not use markdown headings or code fences.",
  "Stay shorter than the source unless a fixed JSON contract requires structure.",
  `If the evidence is insufficient, follow the task-specific insufficiency rule and do not guess.`
];

const BUILT_IN_POLICIES: Record<PromptPolicyName, Omit<PromptPolicy, "sharedRules">> = {
  "test-status": {
    name: "test-status",
    responseMode: "text",
    taskRules: [
      "Determine whether the tests passed.",
      "If they failed, state that clearly and list only the failing tests, suites, or the first concrete error signals.",
      "If they passed, say so directly in one short line or a few short bullets.",
      "Ignore irrelevant warnings, timing, and passing details unless they help answer the question.",
      `If you cannot tell whether tests passed, reply exactly with: ${INSUFFICIENT_SIGNAL_TEXT}`
    ]
  },
  "audit-critical": {
    name: "audit-critical",
    responseMode: "json",
    outputContract:
      '{"status":"ok|insufficient","vulnerabilities":[{"package":string,"severity":"critical|high","remediation":string}],"summary":string}',
    taskRules: [
      "Return only valid JSON.",
      'Use this exact contract: {"status":"ok|insufficient","vulnerabilities":[{"package":string,"severity":"critical|high","remediation":string}],"summary":string}.',
      "Extract only vulnerabilities explicitly marked high or critical in the input.",
      "Treat sparse lines like 'lodash: critical vulnerability' or 'axios: high severity advisory' as sufficient evidence when package and severity are explicit.",
      "Do not invent package names, severities, CVEs, or remediations.",
      'If the input clearly contains no qualifying vulnerabilities, return {"status":"ok","vulnerabilities":[],"summary":"No high or critical vulnerabilities found in the provided input."}.',
      `If the input does not provide enough evidence to determine vulnerability status, return status "insufficient" and use "${INSUFFICIENT_SIGNAL_TEXT}" in summary.`
    ]
  },
  "diff-summary": {
    name: "diff-summary",
    responseMode: "json",
    outputContract:
      '{"status":"ok|insufficient","answer":string,"evidence":string[],"risks":string[]}',
    taskRules: [
      "Return only valid JSON.",
      'Use this exact contract: {"status":"ok|insufficient","answer":string,"evidence":string[],"risks":string[]}.',
      "Summarize what changed at a high level, grounded only in the visible diff or output.",
      "Evidence should cite the most important visible files, modules, resources, or actions.",
      "Risks should include migrations, config changes, security changes, destructive actions, or unknown impact when visible.",
      `If the change signal is incomplete, return status "insufficient" and use "${INSUFFICIENT_SIGNAL_TEXT}" in answer.`
    ]
  },
  "build-failure": {
    name: "build-failure",
    responseMode: "text",
    taskRules: [
      "Identify the most likely root cause of the build failure.",
      "Give the first concrete fix or next step in the same answer.",
      "Keep the response to 1 or 2 short sentences.",
      `If the root cause is not visible, reply exactly with: ${INSUFFICIENT_SIGNAL_TEXT}`
    ]
  },
  "log-errors": {
    name: "log-errors",
    responseMode: "text",
    taskRules: [
      "Return at most 5 short bullet points.",
      "Extract only the most relevant error or failure signals.",
      "Prefer recurring or top-level errors over long stack traces.",
      "Do not dump full traces unless a single trace line is the key signal.",
      `If there is no clear error signal, reply exactly with: ${INSUFFICIENT_SIGNAL_TEXT}`
    ]
  },
  "typecheck-summary": {
    name: "typecheck-summary",
    responseMode: "text",
    taskRules: [
      "Return at most 5 short bullet points.",
      "Determine whether the typecheck failed or passed.",
      "Group repeated diagnostics into root-cause buckets instead of echoing many duplicate lines.",
      "Mention the first concrete files, symbols, or error categories to fix when they are visible.",
      "Prefer compiler or type-system errors over timing, progress, or summary noise.",
      "If the output clearly indicates success, say that briefly and do not add extra bullets.",
      `If you cannot tell whether the typecheck failed, reply exactly with: ${INSUFFICIENT_SIGNAL_TEXT}`
    ]
  },
  "lint-failures": {
    name: "lint-failures",
    responseMode: "text",
    taskRules: [
      "Return at most 5 short bullet points.",
      "Determine whether lint failed or whether there are no blocking lint failures.",
      "Group repeated rule violations instead of listing the same rule many times.",
      "Mention the top offending files and rule names when they are visible.",
      "Distinguish blocking failures from warnings only when that distinction is clearly visible in the input.",
      "Do not invent autofixability; only mention autofix or --fix support when the tool output explicitly says so.",
      "If the output clearly indicates success or no blocking failures, say that briefly and stop.",
      `If there is not enough evidence to determine the lint result, reply exactly with: ${INSUFFICIENT_SIGNAL_TEXT}`
    ]
  },
  "infra-risk": {
    name: "infra-risk",
    responseMode: "json",
    outputContract:
      '{"verdict":"pass|fail|unclear","reason":string,"evidence":string[]}',
    taskRules: [
      "Return only valid JSON.",
      'Use this exact contract: {"verdict":"pass|fail|unclear","reason":string,"evidence":string[]}.',
      'Return "fail" when the input contains explicit destructive or clearly risky signals such as destroy, delete, drop, recreate, replace, revoke, deny, downtime, data loss, IAM risk, or network exposure.',
      'Treat short plan summaries like "1 to destroy" or "resources to destroy" as enough evidence for "fail".',
      'Return "pass" only when the input clearly shows no risky changes or explicitly safe behavior.',
      'Return "unclear" when the input is incomplete, ambiguous, or does not show enough evidence to judge safety.',
      "Evidence should contain the shortest concrete lines or phrases that justify the verdict."
    ]
  }
};

export function isPromptPolicyName(value: string): value is PromptPolicyName {
  return value in BUILT_IN_POLICIES;
}

export function resolvePromptPolicy(args: {
  format: OutputFormat;
  outputContract?: string;
  policyName?: PromptPolicyName;
}): PromptPolicy {
  if (args.policyName) {
    const policy = BUILT_IN_POLICIES[args.policyName];
    return {
      ...policy,
      sharedRules: SHARED_RULES
    };
  }

  const genericPolicy = getGenericFormatPolicy(args.format, args.outputContract);

  return {
    name: `generic-${args.format}`,
    responseMode: genericPolicy.responseMode,
    outputContract: genericPolicy.outputContract,
    sharedRules: SHARED_RULES,
    taskRules: genericPolicy.taskRules
  };
}
