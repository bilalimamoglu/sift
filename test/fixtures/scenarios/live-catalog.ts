import fs from "node:fs";
import path from "node:path";
import {
  liveSessionManifestSchema,
  type LiveSessionFixture
} from "./live-contracts.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const liveSessionDir = path.join(repoRoot, "scenarios", "live-sessions");

export function loadLiveSessionFixtures(): LiveSessionFixture[] {
  const entries = fs
    .readdirSync(liveSessionDir)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  return entries.map((name) => {
    const raw = fs.readFileSync(path.join(liveSessionDir, name), "utf8");
    return liveSessionManifestSchema.parse(JSON.parse(raw));
  });
}
