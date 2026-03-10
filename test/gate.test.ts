import { describe, expect, it } from "vitest";
import {
  assertSupportedFailOnFormat,
  evaluateGate,
  supportsFailOnPreset
} from "../src/core/gate.js";

describe("gate evaluation", () => {
  it("supports only the built-in gating presets", () => {
    expect(supportsFailOnPreset("infra-risk")).toBe(true);
    expect(supportsFailOnPreset("audit-critical")).toBe(true);
    expect(supportsFailOnPreset("test-status")).toBe(false);
    expect(supportsFailOnPreset(undefined)).toBe(false);
  });

  it("requires the preset's default machine-readable format", () => {
    expect(() =>
      assertSupportedFailOnFormat({
        presetName: "infra-risk",
        format: "verdict"
      })
    ).not.toThrow();
    expect(() =>
      assertSupportedFailOnFormat({
        presetName: "audit-critical",
        format: "json"
      })
    ).not.toThrow();

    expect(() =>
      assertSupportedFailOnFormat({
        presetName: "infra-risk",
        format: "json"
      })
    ).toThrow("default verdict format");
    expect(() =>
      assertSupportedFailOnFormat({
        presetName: "audit-critical",
        format: "brief"
      })
    ).toThrow("default json format");
  });

  it("fails on infra-risk fail verdicts", () => {
    expect(
      evaluateGate({
        presetName: "infra-risk",
        output: JSON.stringify({
          verdict: "fail",
          reason: "risky",
          evidence: ["Plan: 1 to destroy"]
        })
      }).shouldFail
    ).toBe(true);
  });

  it("does not fail on infra-risk pass or unclear verdicts", () => {
    expect(
      evaluateGate({
        presetName: "infra-risk",
        output: JSON.stringify({
          verdict: "pass",
          reason: "safe",
          evidence: []
        })
      }).shouldFail
    ).toBe(false);

    expect(
      evaluateGate({
        presetName: "infra-risk",
        output: JSON.stringify({
          verdict: "unclear",
          reason: "not enough signal",
          evidence: []
        })
      }).shouldFail
    ).toBe(false);
  });

  it("fails on audit-critical outputs with vulnerabilities", () => {
    expect(
      evaluateGate({
        presetName: "audit-critical",
        output: JSON.stringify({
          status: "ok",
          vulnerabilities: [{ package: "lodash", severity: "critical" }],
          summary: "One vulnerability found."
        })
      }).shouldFail
    ).toBe(true);
  });

  it("does not fail on audit-critical empty, insufficient, or error outputs", () => {
    expect(
      evaluateGate({
        presetName: "audit-critical",
        output: JSON.stringify({
          status: "ok",
          vulnerabilities: [],
          summary: "None found."
        })
      }).shouldFail
    ).toBe(false);

    expect(
      evaluateGate({
        presetName: "audit-critical",
        output: JSON.stringify({
          status: "insufficient",
          vulnerabilities: [],
          summary: "Insufficient signal in the provided input."
        })
      }).shouldFail
    ).toBe(false);

    expect(
      evaluateGate({
        presetName: "audit-critical",
        output: JSON.stringify({
          status: "error",
          reason: "Provider returned HTTP 429",
          retriable: true
        })
      }).shouldFail
    ).toBe(false);
  });

  it("skips unparseable output", () => {
    expect(
      evaluateGate({
        presetName: "infra-risk",
        output: "Sift fallback triggered (Provider returned HTTP 429)."
      }).shouldFail
    ).toBe(false);
  });
});
