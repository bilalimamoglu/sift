import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/prompts/buildPrompt.js";

describe("buildPrompt", () => {
  it("builds a brief prompt with compact instructions", () => {
    const prompt = buildPrompt({
      question: "did tests pass?",
      format: "brief",
      input: "12 passed"
    });

    expect(prompt.responseMode).toBe("text");
    expect(prompt.prompt).toContain("Answer only from the provided command output.");
    expect(prompt.prompt).toContain("Never ask for more input or more context.");
    expect(prompt.prompt).toContain("did tests pass?");
  });

  it("builds a verdict contract with conservative risk instructions", () => {
    const prompt = buildPrompt({
      question: "is this safe?",
      format: "verdict",
      input: "Plan: 1 to add, 2 to destroy"
    });

    expect(prompt.responseMode).toBe("json");
    expect(prompt.prompt).toContain('"verdict":"pass|fail|unclear"');
    expect(prompt.prompt).toContain("destroy, delete, drop, recreate, replace");
  });

  it("builds an infra-risk policy prompt", () => {
    const prompt = buildPrompt({
      question: "is this safe to apply?",
      format: "verdict",
      policyName: "infra-risk",
      input: "Plan: 2 to add, 1 to destroy"
    });

    expect(prompt.responseMode).toBe("json");
    expect(prompt.prompt).toContain("Task policy: infra-risk");
    expect(prompt.prompt).toContain("IAM risk");
  });

  it("builds a typecheck-summary policy prompt", () => {
    const prompt = buildPrompt({
      question: "what failed in typecheck?",
      format: "bullets",
      policyName: "typecheck-summary",
      input: "src/app.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'."
    });

    expect(prompt.responseMode).toBe("text");
    expect(prompt.prompt).toContain("Task policy: typecheck-summary");
    expect(prompt.prompt).toContain("Group repeated diagnostics into root-cause buckets");
    expect(prompt.prompt).toContain("reply exactly with: Insufficient signal in the provided input.");
  });

  it("builds a lint-failures policy prompt", () => {
    const prompt = buildPrompt({
      question: "what broke lint?",
      format: "bullets",
      policyName: "lint-failures",
      input: "src/app.ts:1:1  error  Unexpected any  @typescript-eslint/no-explicit-any"
    });

    expect(prompt.responseMode).toBe("text");
    expect(prompt.prompt).toContain("Task policy: lint-failures");
    expect(prompt.prompt).toContain("Group repeated rule violations");
    expect(prompt.prompt).toContain("Do not invent autofixability");
  });
});
