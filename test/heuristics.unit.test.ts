import { describe, expect, it } from "vitest";
import { applyHeuristicPolicy } from "../src/core/heuristics.js";

describe("heuristic policies", () => {
  it("returns null when no policy is active", () => {
    expect(applyHeuristicPolicy(undefined, "anything")).toBeNull();
  });

  it("covers test-status success, skipped, failure, collection error, and empty input", () => {
    expect(applyHeuristicPolicy("test-status", "")).toBeNull();

    expect(
      applyHeuristicPolicy("test-status", "12 passed, 0 failed, 2 skipped")
    ).toContain("2 skips");

    const failed = applyHeuristicPolicy(
      "test-status",
      "1 passed, 2 failed\nFAILED test_one\nERROR test_two"
    );
    expect(failed).toContain("Tests did not pass.");
    expect(failed).toContain("2 tests failed.");
    expect(failed).toContain("FAILED test_one");

    const collection = applyHeuristicPolicy(
      "test-status",
      "134 errors during collection"
    );
    expect(collection).toContain("Tests did not complete.");
    expect(collection).toContain("134 errors occurred during collection.");

    const singularCollection = applyHeuristicPolicy(
      "test-status",
      "1 error during collection"
    );
    expect(singularCollection).toContain("1 error occurred during collection.");

    const errorOnly = applyHeuristicPolicy(
      "test-status",
      "1 passed, 0 failed, 2 errors\nERROR setup failed"
    );
    expect(errorOnly).toContain("2 errors occurred.");

    expect(applyHeuristicPolicy("test-status", "test output with no summary")).toBeNull();
  });

  it("covers audit-critical sparse parsing branches", () => {
    expect(
      applyHeuristicPolicy(
        "audit-critical",
        "lodash: critical vulnerability\naxios: high severity advisory"
      )
    ).toContain('"package": "lodash"');

    expect(
      applyHeuristicPolicy("audit-critical", "critical vulnerability with no package")
    ).toBeNull();
    expect(applyHeuristicPolicy("audit-critical", "low severity only")).toBeNull();
    expect(
      applyHeuristicPolicy("audit-critical", "lodash: critical vulnerability")
    ).toContain("One critical vulnerability found in lodash.");
  });

  it("covers infra-risk fail, pass, safe, and null branches", () => {
    expect(
      applyHeuristicPolicy("infra-risk", "Plan: 1 to destroy")
    ).toContain('"verdict": "fail"');
    expect(
      applyHeuristicPolicy("infra-risk", "Plan: 0 to destroy")
    ).toContain('"verdict": "pass"');
    expect(
      applyHeuristicPolicy("infra-risk", "No changes. Infrastructure is safe to apply.")
    ).toContain('"verdict": "pass"');
    expect(applyHeuristicPolicy("infra-risk", "added one bucket")).toBeNull();
  });

  it("returns null for unsupported policy names", () => {
    expect(applyHeuristicPolicy("lint-failures", "lint failed")).toBeNull();
  });
});
