import { describe, expect, it } from "vitest";
import { redactInput } from "../src/core/redact.js";

describe("redactInput", () => {
  it("masks bearer tokens and emails", () => {
    const output = redactInput(
      "Authorization: Bearer abc123 test@example.com",
      { strict: false }
    );

    expect(output).toContain("Bearer ***");
    expect(output).toContain("***@***");
  });

  it("masks password assignments and strict query secrets", () => {
    const output = redactInput(
      "password=secret https://api.test.local?token=abc1234567890",
      { strict: true }
    );

    expect(output).toContain("password=***");
    expect(output).toContain("token=***");
  });
});
