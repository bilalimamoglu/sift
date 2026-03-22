import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { scenarioManifestSchema, type ScenarioManifest } from "./contracts.js";

function scenarioFamilyDir(family: string): string {
  return path.resolve(import.meta.dirname, "../../../scenarios", family);
}

export function loadScenarioFamily(family: string): ScenarioManifest[] {
  const dir = scenarioFamilyDir(family);
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const raw = readFileSync(path.join(dir, entry), "utf8");
      return scenarioManifestSchema.parse(JSON.parse(raw));
    });
}
