import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildDiscoverHints, renderDiscoverReport, renderGainReport, summarizeHistory } from "../../../src/core/history.js";
import { analyzeTestStatus } from "../../../src/core/heuristics.js";
import { buildInsufficientSignalOutput } from "../../../src/core/insufficient.js";
import {
  buildTestStatusDiagnoseContract,
  buildTestStatusPublicDiagnoseContract
} from "../../../src/core/testStatusDecision.js";
import {
  trustDiagnoseFixtureSchema,
  trustHistoryFixtureSchema,
  trustInsufficientFixtureSchema,
  trustRegressionManifestSchema,
  type TrustRegressionManifest
} from "./trust-contracts.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const trustScenarioDir = path.join(repoRoot, "scenarios", "trust-regression");

const fixtureModuleLoaders = {
  "test/fixtures/trust/history.ts": () => import("../trust/history.js"),
  "test/fixtures/trust/insufficient.ts": () => import("../trust/insufficient.js"),
  "test/fixtures/trust/test-status.ts": () => import("../trust/test-status.js")
} as const;

export interface TrustRegressionRunResult {
  manifest: TrustRegressionManifest;
  renderedText: string;
  outputJson: unknown | null;
}

function loadFixtureExportSpec(ref: string): { modulePath: string; exportName: string | null } {
  const [rawModulePath, exportName] = ref.split("#", 2);
  return {
    modulePath: rawModulePath ?? ref,
    exportName: exportName ?? null
  };
}

async function loadFixtureValue(fixtureRef: string): Promise<unknown> {
  const { modulePath, exportName } = loadFixtureExportSpec(fixtureRef);

  if (modulePath.endsWith(".ts")) {
    const importer =
      fixtureModuleLoaders[modulePath as keyof typeof fixtureModuleLoaders];
    if (!importer) {
      throw new Error(`Unknown trust fixture module: ${modulePath}`);
    }
    const loaded = await importer();
    if (!exportName) {
      throw new Error(`Fixture module refs must include a named export: ${modulePath}`);
    }
    const value = loaded[exportName as keyof typeof loaded];
    if (value === undefined) {
      throw new Error(`Missing export ${exportName} in ${modulePath}`);
    }
    return value;
  }

  return readFileSync(path.join(repoRoot, modulePath), "utf8");
}

export function loadTrustRegressionScenarios(): TrustRegressionManifest[] {
  return readdirSync(trustScenarioDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const raw = readFileSync(path.join(trustScenarioDir, entry), "utf8");
      return trustRegressionManifestSchema.parse(JSON.parse(raw));
    });
}

export async function runTrustRegressionScenario(
  manifest: TrustRegressionManifest
): Promise<TrustRegressionRunResult> {
  switch (manifest.surface) {
    case "gain-report": {
      const fixture = trustHistoryFixtureSchema.parse(await loadFixtureValue(manifest.fixtureRef));
      const summary = summarizeHistory(fixture.events);
      const renderedText = renderGainReport({
        summary,
        events: fixture.events,
        byPreset: fixture.byPreset ?? true
      });
      return { manifest, renderedText, outputJson: null };
    }

    case "discover-report": {
      const fixture = trustHistoryFixtureSchema.parse(await loadFixtureValue(manifest.fixtureRef));
      const hints = buildDiscoverHints(fixture.events);
      const renderedText = renderDiscoverReport({
        events: fixture.events,
        hints,
        days: fixture.days
      });
      return { manifest, renderedText, outputJson: null };
    }

    case "insufficient-hint": {
      const fixture = trustInsufficientFixtureSchema.parse(await loadFixtureValue(manifest.fixtureRef));
      const renderedText = buildInsufficientSignalOutput(fixture.input);
      return { manifest, renderedText, outputJson: null };
    }

    case "diagnose-public-json": {
      const maybeFixture = await loadFixtureValue(manifest.fixtureRef);
      const fixture =
        typeof maybeFixture === "string"
          ? trustDiagnoseFixtureSchema.parse({ rawOutput: maybeFixture })
          : trustDiagnoseFixtureSchema.parse(maybeFixture);
      const analysis = analyzeTestStatus(fixture.rawOutput);
      const decision = buildTestStatusDiagnoseContract({
        input: fixture.rawOutput,
        analysis,
        resolvedTests: fixture.resolvedTests,
        remainingTests: fixture.remainingTests
      });
      const outputJson = buildTestStatusPublicDiagnoseContract({
        contract: decision.contract,
        remainingSubsetAvailable: fixture.remainingSubsetAvailable ?? false,
        includeTestIds: fixture.includeTestIds ?? false
      });
      return {
        manifest,
        renderedText: JSON.stringify(outputJson, null, 2),
        outputJson
      };
    }
  }
}
