import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testStatusIncidentArtifacts } from "./fixtures/bench/test-status/incidents.js";
import { repoRoot } from "./helpers/cli.js";

describe("test-status incident archive", () => {
  it("keeps the historical phase 4a incident captures intact and excluded from sync", () => {
    const root = repoRoot();
    const incidentReadmePath = path.join(
      root,
      "examples",
      "incidents",
      "test-status-phase4a",
      "README.md"
    );
    const incidentSummaryPath = path.join(
      root,
      "examples",
      "incidents",
      "test-status-phase4a",
      "before-vs-after-summary.md"
    );
    const examplesReadmePath = path.join(root, "examples", "README.md");
    const syncTestPath = path.join(root, "test", "examples.sync.test.ts");

    expect(testStatusIncidentArtifacts).toHaveLength(6);

    const incidentReadme = fs.readFileSync(incidentReadmePath, "utf8");
    const incidentSummary = fs.readFileSync(incidentSummaryPath, "utf8");
    const examplesReadme = fs.readFileSync(examplesReadmePath, "utf8");
    const syncTest = fs.readFileSync(syncTestPath, "utf8");

    expect(incidentReadme).not.toContain("/Users/");
    expect(incidentSummary).not.toContain("/Users/");
    expect(examplesReadme).not.toContain("/Users/");
    expect(syncTest).not.toContain("examples/incidents/");

    for (const artifact of testStatusIncidentArtifacts) {
      const artifactPath = path.join(root, artifact.artifactPath);
      expect(fs.existsSync(artifactPath), `${artifact.artifactPath} should exist`).toBe(true);

      const content = fs.readFileSync(artifactPath, "utf8");
      expect(content).not.toContain("/Users/");
      expect(incidentReadme).toContain(path.basename(artifact.artifactPath));
      expect(examplesReadme).toContain(path.basename(artifact.artifactPath));

      if (artifact.currentArtifactPath) {
        expect(incidentSummary).toContain(`## ${artifact.id}`);
        const currentArtifactPath = path.join(root, artifact.currentArtifactPath);
        expect(
          fs.existsSync(currentArtifactPath),
          `${artifact.currentArtifactPath} should exist`
        ).toBe(true);

        const currentContent = fs.readFileSync(currentArtifactPath, "utf8");
        expect(currentContent).not.toContain("/Users/");
        expect(incidentReadme).toContain(path.basename(artifact.currentArtifactPath));
        expect(examplesReadme).toContain(path.basename(artifact.currentArtifactPath));
        expect(incidentSummary).toContain(path.basename(artifact.currentArtifactPath));
      }
    }

    const recoveredNote = testStatusIncidentArtifacts.find(
      (artifact) => artifact.id === "targeted-initial-sift-misroute"
    );
    expect(recoveredNote).toMatchObject({
      artifactKind: "note",
      exactTextRecovered: false
    });
  });
});
