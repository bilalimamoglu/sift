import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";
import { runDistCliAsync } from "./helpers/cli.js";

describe("dist e2e", () => {
  it("runs the built cli against a fake provider", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "All tests passed." } }]
      }
    }));

    try {
      const result = await runDistCliAsync({
        args: [
          "did tests pass?",
          "--provider",
          "openai-compatible",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model"
        ],
        input: "Ran 12 tests\n12 passed\n"
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("All tests passed.");
    } finally {
      await server.close();
    }
  });

  it("keeps doctor and agent preview aligned in the built cli", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-home-"));

    const doctor = await runDistCliAsync({
      args: ["doctor"],
      env: {
        HOME: home
      }
    });

    const agentPreview = await runDistCliAsync({
      args: ["agent", "show", "codex"],
      env: {
        HOME: home
      }
    });
    const claudePreview = await runDistCliAsync({
      args: ["agent", "show", "claude"],
      env: {
        HOME: home
      }
    });

    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("setupStatus: Configured");
    expect(doctor.stdout).toContain("defaultPath: Default path: use `sift exec`");
    expect(doctor.stdout).toContain("optionalBeta: Optional beta shortcut: use `sift hook`");

    expect(agentPreview.status).toBe(0);
    expect(agentPreview.stdout).toContain("Codex instructions preview");
    expect(agentPreview.stdout).toContain("Default path: use `sift exec`");
    expect(agentPreview.stdout).toContain("Optional beta shortcut: use `sift hook`");
    expect(claudePreview.status).toBe(0);
    expect(claudePreview.stdout).toContain("Claude instructions preview");
    expect(claudePreview.stdout).toContain("command pack target");
  });

  it("installs the tiny native payloads safely in the built cli", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-native-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-native-cwd-"));

    const codexSkill = await runDistCliAsync({
      args: ["skill", "install", "codex", "--scope", "global", "--yes"],
      cwd,
      env: {
        HOME: home
      }
    });
    const claudeInstall = await runDistCliAsync({
      args: ["agent", "install", "claude", "--scope", "global", "--yes"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(codexSkill.status).toBe(0);
    expect(claudeInstall.status).toBe(0);
    expect(
      await fs.readFile(path.join(home, ".codex", "skills", "sift", "SKILL.md"), "utf8")
    ).toContain("<!-- sift:generated codex-skill -->");
    expect(
      await fs.readFile(path.join(home, ".claude", "commands", "sift", "help.md"), "utf8")
    ).toContain("<!-- sift:generated claude-command help -->");
  });
});
