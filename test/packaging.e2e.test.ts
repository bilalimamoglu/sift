import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers/cli.js";

describe("packaging e2e", () => {
  it("packs and runs the installed binary", async () => {
    const root = repoRoot();
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-home-"));
    const npmCache = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-cache-"));
    const env = {
      ...process.env,
      HOME: home,
      NPM_CONFIG_CACHE: npmCache,
      npm_config_cache: npmCache
    };
    const tarball = execSync("npm pack", {
      cwd: root,
      encoding: "utf8",
      env
    }).trim();
    const tarballContents = execSync(`tar -tf "${path.join(root, tarball)}"`, {
      encoding: "utf8",
      env
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-"));

    execSync(`npm init -y`, {
      cwd: dir,
      stdio: "pipe",
      env
    });
    execSync(`npm install "${path.join(root, tarball)}"`, {
      cwd: dir,
      stdio: "pipe",
      env
    });

    const result = spawnSync("npx", ["--no-install", "sift", "--help"], {
      cwd: dir,
      env,
      encoding: "utf8"
    });
    const doctor = spawnSync("npx", ["--no-install", "sift", "doctor"], {
      cwd: dir,
      env,
      encoding: "utf8"
    });
    const agentPreview = spawnSync("npx", ["--no-install", "sift", "agent", "show", "codex"], {
      cwd: dir,
      env,
      encoding: "utf8"
    });
    const skillInstall = spawnSync(
      "npx",
      ["--no-install", "sift", "skill", "install", "codex", "--scope", "global", "--yes"],
      {
        cwd: dir,
        env,
        encoding: "utf8"
      }
    );
    const claudeInstall = spawnSync(
      "npx",
      ["--no-install", "sift", "agent", "install", "claude", "--scope", "global", "--yes"],
      {
        cwd: dir,
        env,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    expect(doctor.status).toBe(0);
    expect(agentPreview.status).toBe(0);
    expect(skillInstall.status).toBe(0);
    expect(claudeInstall.status).toBe(0);
    expect(tarballContents).not.toContain("assets/brand");
    expect(result.stdout).toContain("sift [question]");
    expect(result.stdout).toContain("  \\\\  //");
    expect(result.stdout).toContain("choose agent-escalation, provider-assisted, or local-only");
    expect(doctor.stdout).toContain("setupStatus: Configured");
    expect(doctor.stdout).toContain("defaultPath: Default path: use `sift exec`");
    expect(agentPreview.stdout).toContain("Codex instructions preview");
    expect(agentPreview.stdout).toContain("Default path: use `sift exec`");
    expect(
      await fs.readFile(path.join(home, ".codex", "skills", "sift", "SKILL.md"), "utf8")
    ).toContain("<!-- sift:generated codex-skill -->");
    expect(
      await fs.readFile(path.join(home, ".claude", "commands", "sift", "test-status.md"), "utf8")
    ).toContain("<!-- sift:generated claude-command test-status -->");
  });
});
