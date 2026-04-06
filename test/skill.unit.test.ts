import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installSkill,
  normalizeSkillRuntime,
  normalizeSkillScope,
  removeSkill,
  resolveSkillTargetPath,
  showSkill,
  statusSkills
} from "../src/commands/skill.js";
import { renderCodexSkill } from "../src/runtime-payloads/codex-skill.js";

function createIo() {
  let stdout = "";
  let stderr = "";

  return {
    stdinIsTTY: true,
    stdoutIsTTY: false,
    async ask() {
      return "";
    },
    write(message: string) {
      stdout += message;
    },
    error(message: string) {
      stderr += message;
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}

describe("skill commands", () => {
  it("normalizes runtime, scope, and default target paths", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-skill-cwd-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-skill-home-"));

    expect(normalizeSkillRuntime("codex")).toBe("codex");
    expect(normalizeSkillRuntime("cursor")).toBe("cursor");
    expect(() => normalizeSkillRuntime("claude")).toThrow("Unknown skill runtime. Use codex or cursor.");
    expect(normalizeSkillScope("local")).toBe("repo");
    expect(normalizeSkillScope("global")).toBe("global");

    expect(
      resolveSkillTargetPath({
        runtime: "codex",
        scope: "repo",
        cwd
      })
    ).toBe(path.join(cwd, ".codex", "skills", "sift", "SKILL.md"));
    expect(
      resolveSkillTargetPath({
        runtime: "codex",
        scope: "global",
        homeDir: home
      })
    ).toBe(path.join(home, ".codex", "skills", "sift", "SKILL.md"));
    expect(
      resolveSkillTargetPath({
        runtime: "cursor",
        scope: "repo",
        cwd
      })
    ).toBe(path.join(cwd, ".cursor", "skills", "sift", "SKILL.md"));
    expect(
      resolveSkillTargetPath({
        runtime: "cursor",
        scope: "global",
        homeDir: home
      })
    ).toBe(path.join(home, ".cursor", "skills", "sift", "SKILL.md"));
  });

  it("shows, installs, reports, and removes the codex skill safely", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-skill-flow-"));
    const io = createIo();

    showSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      io
    });

    expect(io.stdout).toContain("Codex skill preview");
    expect(io.stdout).toContain("Default path: use `sift exec`");
    expect(io.stdout).toContain("Optional beta shortcut: use `sift hook`");

    const dryRunIo = createIo();
    const dryRunStatus = await installSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      dryRun: true,
      io: dryRunIo
    });

    expect(dryRunStatus).toBe(0);
    expect(dryRunIo.stdout).toContain("Dry run: create Codex skill");

    const installIo = createIo();
    const installStatus = await installSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      yes: true,
      io: installIo
    });

    const targetPath = path.join(cwd, ".codex", "skills", "sift", "SKILL.md");
    const guidePath = path.join(cwd, "SIFT.md");
    const written = await fs.readFile(targetPath, "utf8");

    expect(installStatus).toBe(0);
    expect(written).toContain("name: sift");
    expect(written).toContain("Use `sift exec` first for long, noisy, non-interactive output.");
    expect(await fs.readFile(guidePath, "utf8")).toContain("<!-- sift:generated shared-guide -->");

    const statusIo = createIo();
    statusSkills({
      cwd,
      homeDir: cwd,
      io: statusIo
    });
    expect(statusIo.stdout).toContain("Codex skill status");
    expect(statusIo.stdout).toContain("repo: installed");

    const removeIo = createIo();
    const removeStatus = await removeSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      yes: true,
      io: removeIo
    });

    expect(removeStatus).toBe(0);
    await expect(fs.access(targetPath)).rejects.toThrow();
    await expect(fs.access(guidePath)).rejects.toThrow();
  });

  it("refuses to overwrite or remove a custom SKILL.md and still reports the conflict honestly", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-skill-custom-"));
    const targetPath = path.join(cwd, ".codex", "skills", "sift", "SKILL.md");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, "# custom skill\n", "utf8");

    const installIo = createIo();
    const installStatus = await installSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      yes: true,
      io: installIo
    });

    expect(installStatus).toBe(1);
    expect(installIo.stderr).toContain("Refusing to overwrite a custom SKILL.md");

    const statusIo = createIo();
    statusSkills({
      cwd,
      homeDir: cwd,
      io: statusIo
    });
    expect(statusIo.stdout).toContain("custom file present");

    const removeIo = createIo();
    const removeStatus = await removeSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      yes: true,
      io: removeIo
    });
    expect(removeStatus).toBe(1);
    expect(removeIo.stderr).toContain("Refusing to remove a custom SKILL.md");
    expect(await fs.readFile(targetPath, "utf8")).toBe("# custom skill\n");
  });

  it("recognizes and upgrades a legacy sift-managed skill file", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-skill-legacy-"));
    const targetPath = path.join(cwd, ".codex", "skills", "sift", "SKILL.md");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const legacyContent = [
      "---",
      "name: sift",
      "description: legacy",
      "---",
      "",
      "# Sift",
      "",
      "## Decision Table",
      "",
      "- legacy guidance",
      "",
      "The CLI is the product runtime. This skill is a discoverability and workflow guide for Codex."
    ].join("\n");
    await fs.writeFile(targetPath, legacyContent, "utf8");

    const installIo = createIo();
    const installStatus = await installSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      yes: true,
      io: installIo
    });
    expect(installStatus).toBe(0);
    expect(await fs.readFile(targetPath, "utf8")).toContain("<!-- sift:generated codex-skill -->");

    const removeIo = createIo();
    const removeStatus = await removeSkill({
      runtime: "codex",
      scope: "repo",
      cwd,
      yes: true,
      io: removeIo
    });
    expect(removeStatus).toBe(0);
    await expect(fs.access(targetPath)).rejects.toThrow();
  });

  it("shows, installs, reports, and removes the cursor skill safely", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cursor-skill-flow-"));
    const io = createIo();

    showSkill({
      runtime: "cursor",
      scope: "repo",
      cwd,
      io
    });

    expect(io.stdout).toContain("Cursor skill preview");
    expect(io.stdout).toContain("Default path: use `sift exec`");

    const installIo = createIo();
    const installStatus = await installSkill({
      runtime: "cursor",
      scope: "repo",
      cwd,
      yes: true,
      io: installIo
    });

    const targetPath = path.join(cwd, ".cursor", "skills", "sift", "SKILL.md");
    const written = await fs.readFile(targetPath, "utf8");

    expect(installStatus).toBe(0);
    expect(written).toContain("name: sift");
    expect(written).toContain("tiny Cursor-native pointer");

    const statusIo = createIo();
    statusSkills({
      cwd,
      homeDir: cwd,
      io: statusIo
    });
    expect(statusIo.stdout).toContain("Cursor skill status");
    expect(statusIo.stdout).toContain("repo: installed");

    const removeIo = createIo();
    const removeStatus = await removeSkill({
      runtime: "cursor",
      scope: "repo",
      cwd,
      yes: true,
      io: removeIo
    });

    expect(removeStatus).toBe(0);
    await expect(fs.access(targetPath)).rejects.toThrow();
  });

  it("refuses to install a native cursor skill when a compatible codex skill already exists in the same scope", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cursor-skill-conflict-"));
    const codexPath = path.join(cwd, ".codex", "skills", "sift", "SKILL.md");
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.writeFile(codexPath, `${renderCodexSkill("agent-escalation")}\n`, "utf8");

    const showIo = createIo();
    showSkill({
      runtime: "cursor",
      scope: "repo",
      cwd,
      io: showIo
    });
    expect(showIo.stdout).toContain("Cursor already loads the compatible Codex skill");

    const installIo = createIo();
    const installStatus = await installSkill({
      runtime: "cursor",
      scope: "repo",
      cwd,
      yes: true,
      io: installIo
    });

    expect(installStatus).toBe(1);
    expect(installIo.stderr).toContain("Refusing to install a duplicate native Cursor skill");
  });
});
