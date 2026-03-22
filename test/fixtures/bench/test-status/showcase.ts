import { loadScenarioFamily } from "../../scenarios/catalog.js";

export interface TestStatusShowcaseCase {
  id: string;
  fixtureName: string;
  docsSlug: string;
  renderMode: "standard" | "diagnose-json";
  title: string;
  sourceType: TestStatusShowcaseSourceType;
  rawPath: string;
  companionOutputPath: string;
}

export type TestStatusShowcaseSourceType = "synthetic-derived" | "repo-captured";

export const testStatusShowcaseCases: TestStatusShowcaseCase[] = loadScenarioFamily("test-status")
  .flatMap((scenario) =>
    scenario.renders.map((render) => ({
      id: render.id,
      fixtureName: scenario.fixtureName,
      docsSlug: render.docsSlug,
      renderMode: render.renderMode,
      title: render.title,
      sourceType: scenario.sourceType,
      rawPath: scenario.rawPath,
      companionOutputPath: render.companionOutputPath
    }))
  )
  .sort((left, right) => left.docsSlug.localeCompare(right.docsSlug));
