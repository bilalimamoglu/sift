import type { DetailLevel, OutputFormat, PromptPolicyName } from "../types.js";
import { resolvePromptPolicy } from "./policies.js";

export function buildPrompt(args: {
  question: string;
  format: OutputFormat;
  input: string;
  detail?: DetailLevel;
  policyName?: PromptPolicyName;
  outputContract?: string;
}): { prompt: string; responseMode: "text" | "json" } {
  const policy = resolvePromptPolicy({
    format: args.format,
    policyName: args.policyName,
    outputContract: args.outputContract
  });
  const detailRules =
    args.policyName === "test-status" && args.detail === "focused"
      ? [
          "Use a focused failure view.",
          "When the output clearly maps failures to specific tests or modules, group them by dominant error type first.",
          "Within each error group, prefer compact bullets in the form '- test-or-module -> dominant reason'.",
          "Cap focused entries at 6 per error group and end with '- and N more failing modules' if more clear mappings are visible.",
          "If per-test or per-module mapping is unclear, fall back to grouped root causes instead of guessing."
        ]
      : args.policyName === "test-status" && args.detail === "verbose"
        ? [
            "Use a verbose failure view.",
            "When the output clearly maps failures to specific tests or modules, list each visible failing test or module on its own line in the form '- test-or-module -> normalized reason'.",
            "Preserve the original file or module order when the mapping is visible.",
            "Prefer concrete normalized reasons such as missing modules or assertion failures over traceback plumbing.",
            "If per-test or per-module mapping is unclear, fall back to the focused grouped-cause view instead of guessing."
          ]
        : [];
  const prompt = [
    "You are Sift, a CLI output reduction assistant for downstream agents and automation.",
    "Hard rules:",
    ...policy.sharedRules.map((rule) => `- ${rule}`),
    "",
    `Task policy: ${policy.name}`,
    ...policy.taskRules.map((rule) => `- ${rule}`),
    ...detailRules.map((rule) => `- ${rule}`),
    ...(policy.outputContract
      ? ["", `Output contract: ${policy.outputContract}`]
      : []),
    "",
    `Question: ${args.question}`,
    "",
    "Command output:",
    '"""',
    args.input,
    '"""'
  ].join("\n");

  return {
    prompt,
    responseMode: policy.responseMode
  };
}
