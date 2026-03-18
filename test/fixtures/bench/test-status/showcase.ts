export type TestStatusShowcaseSourceType = "synthetic-derived" | "repo-captured";

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

export const testStatusShowcaseCases: TestStatusShowcaseCase[] = [
  {
    id: "pytest-mixed-suite",
    fixtureName: "mixed-full-suite-real",
    docsSlug: "08-pytest-mixed-suite",
    renderMode: "standard",
    title: "Pytest Mixed Suite",
    sourceType: "repo-captured",
    rawPath: "test/fixtures/bench/test-status/real/mixed-full-suite.txt",
    companionOutputPath: "examples/test-status/mixed-full-suite-real.standard.txt"
  },
  {
    id: "vitest-mixed-failures",
    fixtureName: "vitest-mixed-js",
    docsSlug: "09-vitest-mixed-failures",
    renderMode: "standard",
    title: "Vitest Mixed Failures",
    sourceType: "synthetic-derived",
    rawPath: "test/fixtures/bench/test-status/synthetic/vitest-mixed-js.txt",
    companionOutputPath: "examples/test-status/vitest-mixed-js.standard.txt"
  },
  {
    id: "test-status-diagnose-json",
    fixtureName: "mixed-full-suite-real",
    docsSlug: "10-test-status-diagnose-json",
    renderMode: "diagnose-json",
    title: "Test Status Diagnose JSON",
    sourceType: "repo-captured",
    rawPath: "test/fixtures/bench/test-status/real/mixed-full-suite.txt",
    companionOutputPath: "examples/test-status/mixed-full-suite-real.diagnose.json"
  }
];
