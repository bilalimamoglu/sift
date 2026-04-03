import { describe, expect, it } from "vitest";
import { loadScenarioFamily } from "./fixtures/scenarios/catalog.js";

describe("contract-drift scenario catalog", () => {
  it("loads canonical contract-drift scenario manifests", () => {
    const scenarios = loadScenarioFamily("contract-drift");
    expect(scenarios.map((scenario) => scenario.fixtureName)).toEqual([
      "generated-client-drift",
      "snapshot-drift-only-real"
    ]);
    expect(scenarios.map((scenario) => scenario.sourceType)).toEqual([
      "synthetic-derived",
      "repo-captured"
    ]);
  });

  it("maps contract-drift companions to reduced example files", () => {
    const scenarios = loadScenarioFamily("contract-drift");

    expect(scenarios[0]?.renders[0]).toMatchObject({
      docsSlug: "11-generated-client-drift",
      companionOutputPath: "examples/contract-drift/generated-client-drift.reduced.txt"
    });
    expect(scenarios[1]?.renders[0]).toMatchObject({
      docsSlug: "12-snapshot-drift-only-real",
      companionOutputPath: "examples/contract-drift/snapshot-drift-only-real.reduced.txt"
    });
  });
});
