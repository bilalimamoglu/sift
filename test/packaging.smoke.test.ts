import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers/cli.js";

describe("packaging smoke", () => {
  it("packs and runs the installed binary", async () => {
    const root = repoRoot();
    const tarball = execSync("npm pack", {
      cwd: root,
      encoding: "utf8"
    }).trim();
    const tarballContents = execSync(`tar -tf "${path.join(root, tarball)}"`, {
      encoding: "utf8"
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-"));

    execSync(`npm init -y`, {
      cwd: dir,
      stdio: "pipe"
    });
    execSync(`npm install "${path.join(root, tarball)}"`, {
      cwd: dir,
      stdio: "pipe"
    });

    const result = spawnSync("npx", ["--no-install", "sift", "--help"], {
      cwd: dir,
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(tarballContents).not.toContain("assets/brand");
    expect(result.stdout).toContain("sift [question]");
    expect(result.stdout).toContain("  \\\\  //");
  });
});
