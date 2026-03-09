import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers/cli.js";

const root = repoRoot();

describe("release workflow", () => {
  it("declares GitHub and npm metadata in package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8")
    ) as {
      repository?: { type?: string; url?: string };
      homepage?: string;
      bugs?: { url?: string };
    };

    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/bilalimamoglu/sift.git"
    });
    expect(pkg.homepage).toBe("https://github.com/bilalimamoglu/sift#readme");
    expect(pkg.bugs).toEqual({
      url: "https://github.com/bilalimamoglu/sift/issues"
    });
  });

  it("defines a manual trusted-publishing release workflow with tag and GitHub release creation", () => {
    const workflow = fs.readFileSync(
      path.join(root, ".github", "workflows", "release.yml"),
      "utf8"
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("registry-url: \"https://registry.npmjs.org\"");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("environment: release");
    expect(workflow).toContain("npm publish --access public");
    expect(workflow).toContain("git tag -a");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("actions/workflows/ci.yml/runs");
    expect(workflow).toContain("CI must pass on this exact commit before release");
    expect(workflow).toContain('sift exec "did tests pass?" --dry-run -- node -e "console.log(\'12 passed\')"');
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).not.toContain("NPM_TOKEN");
  });
});
