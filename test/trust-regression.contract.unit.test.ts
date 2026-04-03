import { describe, expect, it } from "vitest";
import { loadTrustRegressionScenarios, runTrustRegressionScenario } from "./fixtures/scenarios/trust-catalog.js";

function readDotPath(value: unknown, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }

    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, value);
}

describe("trust regression contract", () => {
  const scenarios = loadTrustRegressionScenarios();

  for (const scenario of scenarios) {
    it(`keeps ${scenario.id} stable`, async () => {
      const result = await runTrustRegressionScenario(scenario);

      for (const expected of scenario.assertions.contains ?? []) {
        expect(result.renderedText).toContain(expected);
      }

      for (const unexpected of scenario.assertions.notContains ?? []) {
        expect(result.renderedText).not.toContain(unexpected);
      }

      for (const assertion of scenario.assertions.jsonEquals ?? []) {
        expect(readDotPath(result.outputJson, assertion.path)).toEqual(assertion.value);
      }

      for (const assertion of scenario.assertions.jsonIncludes ?? []) {
        expect(readDotPath(result.outputJson, assertion.path)).toEqual(expect.stringContaining(assertion.value));
      }
    });
  }
});
