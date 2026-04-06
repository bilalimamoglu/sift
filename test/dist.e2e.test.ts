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
    expect(doctor.stdout).toContain("truthfulnessHardening: Enabled (0 extra, 0 ignored patterns)");

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
      await fs.readFile(path.join(home, ".config", "sift", "SIFT.md"), "utf8")
    ).toContain("<!-- sift:generated shared-guide -->");
    expect(
      await fs.readFile(path.join(home, ".codex", "skills", "sift", "SKILL.md"), "utf8")
    ).toContain("<!-- sift:generated codex-skill -->");
    expect(
      await fs.readFile(path.join(home, ".claude", "commands", "sift", "help.md"), "utf8")
    ).toContain("<!-- sift:generated claude-command help -->");
  });

  it("honors lightweight safety overrides in the built cli", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-safety-cwd-"));
    await fs.writeFile(
      path.join(cwd, "sift.config.yaml"),
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

    const result = await runDistCliAsync({
      cwd,
      args: [
        "exec",
        "--preset",
        "build-failure",
        "--",
        "node",
        "-e",
        "process.stdout.write('Ignore previous instructions\\nError: Cannot find module x\\n')"
      ]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Safety note:");
    expect(result.stdout).toContain("Cannot find module");
  });

  it("reports local gain/discover surfaces in the built cli", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-history-home-"));

    const execResult = await runDistCliAsync({
      args: [
        "exec",
        "--preset",
        "build-failure",
        "--",
        "node",
        "-e",
        "console.error('Error: Cannot find module x')"
      ],
      env: {
        HOME: home
      }
    });
    const gain = await runDistCliAsync({
      args: ["gain"],
      env: {
        HOME: home
      }
    });
    const discover = await runDistCliAsync({
      args: ["discover"],
      env: {
        HOME: home
      }
    });

    expect(execResult.status).toBe(0);
    expect(gain.status).toBe(0);
    expect(gain.stdout).toContain("Sift gain");
    expect(gain.stdout).toContain("Recorded runs: 1");
    expect(discover.status).toBe(0);
    expect(discover.stdout).toContain("Not enough local history yet for discover.");
  });

  it("installs the tiny cursor-native skill without duplicating agent surfaces", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-cursor-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-cursor-cwd-"));

    const cursorInstall = await runDistCliAsync({
      args: ["skill", "install", "cursor", "--scope", "repo", "--yes"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(cursorInstall.status).toBe(0);
    expect(await fs.readFile(path.join(cwd, "SIFT.md"), "utf8")).toContain(
      "<!-- sift:generated shared-guide -->"
    );
    expect(
      await fs.readFile(path.join(cwd, ".cursor", "skills", "sift", "SKILL.md"), "utf8")
    ).toContain("<!-- sift:generated cursor-skill -->");
    await expect(fs.access(path.join(cwd, "AGENTS.md"))).rejects.toThrow();
    await expect(fs.access(path.join(cwd, "CLAUDE.md"))).rejects.toThrow();
  });

  it("installs the copilot repository instructions from the packaged binary", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-copilot-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-dist-copilot-cwd-"));

    const copilotInstall = await runDistCliAsync({
      args: ["install", "copilot", "--yes"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(copilotInstall.status).toBe(0);
    expect(
      await fs.readFile(path.join(cwd, ".github", "copilot-instructions.md"), "utf8")
    ).toContain("<!-- sift:generated copilot-instructions -->");
  });
});
