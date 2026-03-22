import { describe, expect, it } from "vitest";
import { loadScenarioFamily } from "./fixtures/scenarios/catalog.js";
import { testStatusShowcaseCases } from "./fixtures/bench/test-status/showcase.js";

describe("scenario catalog bootstrap", () => {
  it("loads canonical test-status scenario manifests", () => {
    const scenarios = loadScenarioFamily("test-status");
    expect(scenarios.map((scenario) => scenario.fixtureName)).toEqual([
      "mixed-full-suite-real",
      "vitest-mixed-js"
    ]);
    expect(scenarios[0]?.renders.map((render) => render.docsSlug)).toEqual([
      "08-pytest-mixed-suite",
      "10-test-status-diagnose-json"
    ]);
  });

  it("derives the showcase catalog from canonical scenario manifests", () => {
    expect(testStatusShowcaseCases.map((candidate) => candidate.docsSlug)).toEqual([
      "08-pytest-mixed-suite",
      "09-vitest-mixed-failures",
      "10-test-status-diagnose-json"
    ]);
    expect(testStatusShowcaseCases[0]).toMatchObject({
      fixtureName: "mixed-full-suite-real",
      rawPath: "test/fixtures/bench/test-status/real/mixed-full-suite.txt"
    });
    expect(testStatusShowcaseCases[2]).toMatchObject({
      companionOutputPath: "examples/test-status/mixed-full-suite-real.diagnose.json"
    });
  });
});
