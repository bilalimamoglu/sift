export interface TestStatusIncidentArtifact {
  id: string;
  title: string;
  sourceCommand: string;
  artifactPath: string;
  currentArtifactPath?: string;
  artifactKind: "raw-command" | "sift-standard" | "excerpt" | "note";
  issueTags: string[];
  exactTextRecovered: boolean;
}

export const testStatusIncidentArtifacts: TestStatusIncidentArtifact[] = [
  {
    id: "targeted-heuristics-vitest",
    title: "Targeted heuristics vitest failure after fix-hint drift",
    sourceCommand:
      "npx vitest run test/heuristics.unit.test.ts test/bench.script.test.ts test/test-status.showcase.test.ts test/examples.sync.test.ts",
    artifactPath: "examples/incidents/test-status-phase4a/01-targeted-heuristics-vitest.raw.txt",
    artifactKind: "raw-command",
    issueTags: ["contract-drift", "fix-hint", "raw-vitest"],
    exactTextRecovered: true
  },
  {
    id: "targeted-initial-sift-misroute",
    title: "Initial sift pass did not isolate the targeted regression clearly",
    sourceCommand:
      "sift exec --preset test-status -- npx vitest run test/heuristics.unit.test.ts test/bench.script.test.ts test/test-status.showcase.test.ts test/examples.sync.test.ts",
    artifactPath: "examples/incidents/test-status-phase4a/02-targeted-initial-sift-misroute.note.md",
    currentArtifactPath:
      "examples/incidents/test-status-phase4a/02-targeted-initial-sift-misroute.current.txt",
    artifactKind: "note",
    issueTags: ["sift-misroute", "historical-gap"],
    exactTextRecovered: false
  },
  {
    id: "full-suite-provider-followup",
    title: "Full suite sift output leaked provider follow-up parse failure text",
    sourceCommand: "sift exec --preset test-status -- npm test",
    artifactPath: "examples/incidents/test-status-phase4a/03-full-suite-provider-followup.sift.standard.txt",
    currentArtifactPath:
      "examples/incidents/test-status-phase4a/03-full-suite-provider-followup.current.txt",
    artifactKind: "sift-standard",
    issueTags: ["provider-followup", "standard-output", "sift"],
    exactTextRecovered: true
  },
  {
    id: "release-and-exec-vitest",
    title: "Combined raw vitest run showing release workflow and exec smoke regressions",
    sourceCommand: "npx vitest run test/release.workflow.test.ts test/exec.smoke.test.ts",
    artifactPath: "examples/incidents/test-status-phase4a/04-release-and-exec-vitest.raw.txt",
    currentArtifactPath:
      "examples/incidents/test-status-phase4a/04-release-and-exec-vitest.current.txt",
    artifactKind: "raw-command",
    issueTags: ["exec-smoke", "release-workflow", "raw-vitest"],
    exactTextRecovered: true
  },
  {
    id: "exec-smoke-likely-owner-drift",
    title: "Exec smoke failures caused by Likely owner line drift",
    sourceCommand: "npx vitest run test/release.workflow.test.ts test/exec.smoke.test.ts",
    artifactPath: "examples/incidents/test-status-phase4a/05-exec-smoke-likely-owner-drift.excerpt.txt",
    currentArtifactPath:
      "examples/incidents/test-status-phase4a/05-exec-smoke-likely-owner-drift.current.txt",
    artifactKind: "excerpt",
    issueTags: ["exec-smoke", "small-output", "likely-owner"],
    exactTextRecovered: true
  },
  {
    id: "release-workflow-node-version-drift",
    title: "Release workflow failures caused by stale node-version expectations",
    sourceCommand: "npx vitest run test/release.workflow.test.ts test/exec.smoke.test.ts",
    artifactPath: "examples/incidents/test-status-phase4a/06-release-workflow-node-version-drift.excerpt.txt",
    currentArtifactPath:
      "examples/incidents/test-status-phase4a/06-release-workflow-node-version-drift.current.txt",
    artifactKind: "excerpt",
    issueTags: ["release-workflow", "golden-drift", "config-expectation"],
    exactTextRecovered: true
  }
];
