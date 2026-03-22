import { describe, expect, it } from "vitest";
import { loadLiveSessionFixtures } from "./fixtures/scenarios/live-catalog.js";
import { buildLiveSessionFixtures } from "./fixtures/bench/test-status/live-fixtures.js";

describe("live session catalog", () => {
  it("loads canonical live-session benchmark manifests", () => {
    const fixtures = loadLiveSessionFixtures();

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      name: "mixed-full-suite-live",
      capture: {
        sourceType: "captured-session",
        measuredBy: "manual-scorecard",
        tokenMethod: "session-estimate"
      }
    });
  });

  it("derives the live benchmark fixtures from canonical manifests", () => {
    expect(buildLiveSessionFixtures()).toEqual(loadLiveSessionFixtures());
  });
});
