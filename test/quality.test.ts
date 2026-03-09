import { describe, expect, it } from "vitest";
import {
  isRetriableReason,
  looksLikeRejectedModelOutput
} from "../src/core/quality.js";

describe("quality gate", () => {
  it("rejects meta responses", () => {
    expect(
      looksLikeRejectedModelOutput({
        source: "12 passed",
        candidate: "Please provide more context from the provided command output.",
        responseMode: "text"
      })
    ).toBe(true);
  });

  it("rejects markdown wrapped JSON", () => {
    expect(
      looksLikeRejectedModelOutput({
        source: "critical vuln",
        candidate: '```json\n{"status":"ok"}\n```',
        responseMode: "json"
      })
    ).toBe(true);
  });

  it("treats rate limits and timeouts as retriable", () => {
    expect(isRetriableReason("Provider returned HTTP 429")).toBe(true);
    expect(isRetriableReason("Provider request timed out")).toBe(true);
    expect(isRetriableReason("Provider returned HTTP 400")).toBe(false);
  });
});
