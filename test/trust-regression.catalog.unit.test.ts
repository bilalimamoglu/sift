import { describe, expect, it } from "vitest";
import { loadTrustRegressionScenarios } from "./fixtures/scenarios/trust-catalog.js";

describe("trust regression scenario catalog", () => {
  it("loads the bootstrap trust-regression manifests", () => {
    const scenarios = loadTrustRegressionScenarios();

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "diagnose-exact-window-traceback-anchor",
      "diagnose-search-only-anchor",
      "discover-trivial-typecheck-misses-stay-quiet",
      "gain-build-failure-contamination",
      "insufficient-prose-doc-suppresses-test-status"
    ]);
  });

  it("keeps plan coverage and surfaces explicit for each manifest", () => {
    const scenarios = loadTrustRegressionScenarios();

    expect(scenarios).toHaveLength(5);
    expect(scenarios.map((scenario) => scenario.surface)).toEqual([
      "diagnose-public-json",
      "diagnose-public-json",
      "discover-report",
      "gain-report",
      "insufficient-hint"
    ]);
    expect(scenarios.map((scenario) => scenario.coversPlans)).toEqual([
      ["08-03"],
      ["08-03"],
      ["08-01"],
      ["08-01"],
      ["08-02"]
    ]);
  });
});
