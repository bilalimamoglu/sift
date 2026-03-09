import type { OutputFormat, PromptPolicyName } from "../types.js";
import { resolvePromptPolicy } from "./policies.js";

export function buildPrompt(args: {
  question: string;
  format: OutputFormat;
  input: string;
  policyName?: PromptPolicyName;
  outputContract?: string;
}): { prompt: string; responseMode: "text" | "json" } {
  const policy = resolvePromptPolicy({
    format: args.format,
    policyName: args.policyName,
    outputContract: args.outputContract
  });
  const prompt = [
    "You are Sift, a CLI output reduction assistant for downstream agents and automation.",
    "Hard rules:",
    ...policy.sharedRules.map((rule) => `- ${rule}`),
    "",
    `Task policy: ${policy.name}`,
    ...policy.taskRules.map((rule) => `- ${rule}`),
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
