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
});
