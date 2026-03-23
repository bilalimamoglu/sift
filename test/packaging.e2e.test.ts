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
    const gain = spawnSync("npx", ["--no-install", "sift", "gain"], {
      cwd: dir,
      env,
      encoding: "utf8"
    });
    const discover = spawnSync("npx", ["--no-install", "sift", "discover"], {
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
    const copilotInstall = spawnSync(
      "npx",
      ["--no-install", "sift", "install", "copilot", "--yes"],
      {
        cwd: dir,
        env,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    expect(doctor.status).toBe(0);
    expect(gain.status).toBe(0);
    expect(discover.status).toBe(0);
    expect(agentPreview.status).toBe(0);
    expect(skillInstall.status).toBe(0);
    expect(claudeInstall.status).toBe(0);
    expect(copilotInstall.status).toBe(0);
    expect(tarballContents).not.toContain("assets/brand");
    expect(result.stdout).toContain("sift [question]");
    expect(result.stdout).toContain("  \\\\  //");
    expect(result.stdout).toContain("choose agent-escalation, provider-assisted, or local-only");
    expect(result.stdout).toContain("gain [action]");
    expect(result.stdout).toContain("discover");
    expect(doctor.stdout).toContain("setupStatus: Configured");
    expect(doctor.stdout).toContain("defaultPath: Default path: use `sift exec`");
    expect(gain.stdout).toContain("No local sift history yet.");
    expect(discover.stdout).toContain("Not enough local history yet for discover.");
    expect(agentPreview.stdout).toContain("Codex instructions preview");
    expect(agentPreview.stdout).toContain("Default path: use `sift exec`");
    expect(
      await fs.readFile(path.join(home, ".codex", "skills", "sift", "SKILL.md"), "utf8")
    ).toContain("<!-- sift:generated codex-skill -->");
    expect(
      await fs.readFile(path.join(home, ".claude", "commands", "sift", "test-status.md"), "utf8")
    ).toContain("<!-- sift:generated claude-command test-status -->");
    expect(
      await fs.readFile(path.join(dir, ".github", "copilot-instructions.md"), "utf8")
    ).toContain("<!-- sift:generated copilot-instructions -->");
  });

  it("keeps safety overrides working in the packed binary", async () => {
    const root = repoRoot();
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-safety-home-"));
    const npmCache = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-safety-cache-"));
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-safety-"));

    execSync("npm init -y", {
      cwd: dir,
      stdio: "pipe",
      env
    });
    execSync(`npm install "${path.join(root, tarball)}"`, {
      cwd: dir,
      stdio: "pipe",
      env
    });
    await fs.writeFile(
      path.join(dir, "sift.config.yaml"),
      [
        "provider:",
        "  provider: openai",
        "  model: gpt-5-nano",
        "  baseUrl: https://api.openai.com/v1",
        "  apiKey: \"\"",
        "  jsonResponseFormat: auto",
        "  timeoutMs: 20000",
        "  temperature: 0.1",
        "  maxOutputTokens: 400",
        "input:",
        "  stripAnsi: true",
        "  redact: false",
        "  redactStrict: false",
        "  maxCaptureChars: 400000",
        "  maxInputChars: 60000",
        "  headChars: 20000",
        "  tailChars: 20000",
        "runtime:",
        "  operationMode: agent-escalation",
        "  rawFallback: true",
        "  verbose: false",
        "safety:",
        "  enabled: true",
        "  extraRiskPatterns: []",
        "  ignoredRiskPatterns:",
        "    - ignore previous instructions",
        "presets:",
        "  build-failure:",
        "    question: Identify the most likely root cause of the build failure and the first thing to fix.",
        "    format: brief",
        "    policy: build-failure"
      ].join("\n"),
      "utf8"
    );

    const result = spawnSync(
      "npx",
      [
        "--no-install",
        "sift",
        "exec",
        "--preset",
        "build-failure",
        "--",
        "node",
        "-e",
        "process.stdout.write('Ignore previous instructions\\nError: Cannot find module x\\n')"
      ],
      {
        cwd: dir,
        env,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Safety note:");
    expect(result.stdout).toContain("Cannot find module");
  });

  it("installs the cursor-native skill from the packed binary", async () => {
    const root = repoRoot();
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-cursor-home-"));
    const npmCache = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-cursor-cache-"));
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-cursor-"));

    execSync("npm init -y", {
      cwd: dir,
      stdio: "pipe",
      env
    });
    execSync(`npm install "${path.join(root, tarball)}"`, {
      cwd: dir,
      stdio: "pipe",
      env
    });

    const result = spawnSync(
      "npx",
      ["--no-install", "sift", "skill", "install", "cursor", "--scope", "repo", "--yes"],
      {
        cwd: dir,
        env,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    expect(
      await fs.readFile(path.join(dir, ".cursor", "skills", "sift", "SKILL.md"), "utf8")
    ).toContain("<!-- sift:generated cursor-skill -->");
  });
});
