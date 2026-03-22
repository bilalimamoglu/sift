import {
  loadLiveSessionFixtures
} from "../../scenarios/live-catalog.js";
import type { LiveSessionFixture } from "../../scenarios/live-contracts.js";
export type {
  LiveStopDepth,
  LiveSessionFlowFixture,
  LiveSessionSiftFlowFixture
} from "../../scenarios/live-contracts.js";

export function buildLiveSessionFixtures(): LiveSessionFixture[] {
  return loadLiveSessionFixtures();
}
