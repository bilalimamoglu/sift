import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const testDir = path.resolve(import.meta.dirname);

const smokeFiles = [
  "agent.smoke.test.ts",
  "cli.smoke.test.ts",
  "exec.smoke.test.ts"
];

const e2eFiles = [
  "dist.e2e.test.ts",
  "docs.acceptance.e2e.test.ts",
  "packaging.e2e.test.ts"
];

function readTestFile(name: string): string {
  return fs.readFileSync(path.join(testDir, name), "utf8");
}

describe("test layer boundaries", () => {
  it("keeps smoke tests source-backed", () => {
    for (const file of smokeFiles) {
      const content = readTestFile(file);

      expect(content, `${file} should not use dist CLI helpers`).not.toContain("runDistCli(");
      expect(content, `${file} should not use dist CLI helpers`).not.toContain(
        "runDistCliAsync("
      );
      expect(content, `${file} should not use the old helper toggle`).not.toContain("useDist");
    }
  });

  it("keeps e2e tests separate from source CLI helpers", () => {
    for (const file of e2eFiles) {
      const content = readTestFile(file);

      expect(content, `${file} should not use source CLI helpers`).not.toContain(
        "runSourceCli("
      );
      expect(content, `${file} should not use source CLI helpers`).not.toContain(
        "runSourceCliAsync("
      );
      expect(content, `${file} should not use the old helper toggle`).not.toContain("useDist");
    }
  });
});
