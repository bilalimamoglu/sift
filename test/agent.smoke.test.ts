import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, runSourceCli, runSourceCliAsync } from "./helpers/cli.js";

describe("agent installer smoke", () => {
  it("shows short previews by default and raw managed blocks on demand", () => {
    const codex = runSourceCli({
      args: ["agent", "show", "codex"]
    });
    const claude = runSourceCli({
      args: ["agent", "show", "claude"]
    });
    const rawCodex = runSourceCli({
      args: ["agent", "show", "codex", "--raw"]
    });

    expect(codex.status).toBe(0);
    expect(codex.stdout).toContain("Codex instructions preview");
    expect(codex.stdout).toContain("Use --raw to print the exact managed block.");
    expect(codex.stdout).toContain("default to sift first, keep raw as the last resort");
    expect(codex.stdout).toContain("standard should usually be enough for first-pass triage");
    expect(codex.stdout).toContain("Only then zoom into what is still broken");
    expect(codex.stdout).toContain("Use diagnose JSON only for automation or machine branching");
    expect(codex.stdout).toContain("If standard already shows bucket-level root cause, anchor, and fix lines");
    expect(codex.stdout).not.toContain("<!-- sift:begin codex -->");
    expect(claude.status).toBe(0);
    expect(claude.stdout).toContain("Claude instructions preview");
    expect(rawCodex.status).toBe(0);
    expect(rawCodex.stdout).toContain("<!-- sift:begin codex -->");
    expect(rawCodex.stdout).toContain("refresh the truth with `sift rerun`");
    expect(rawCodex.stdout).toContain(
      "`sift rerun --remaining` narrows automatically for `pytest` and reruns the full original command for `vitest` and `jest` while keeping the diagnosis focused on what still fails."
    );
    expect(rawCodex.stdout).toContain("--include-test-ids");
    expect(rawCodex.stdout).toContain("read_targets.context_hint.start_line/end_line");
    expect(rawCodex.stdout).toContain("read_targets.context_hint.search_hint");
    expect(rawCodex.stdout).toContain("trust it and report from it directly");
    expect(rawCodex.stdout).toContain("unknown bucket or ends with `Decision: zoom`");
    expect(rawCodex.stdout).toContain("--show-raw");
  });

  it("installs, updates, removes, and reports repo-scope managed blocks safely", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-agent-repo-"));
    const agentsPath = path.join(cwd, "AGENTS.md");
    const claudePath = path.join(cwd, "CLAUDE.md");

    const create = runSourceCli({
      args: ["agent", "install", "codex", "--yes"],
      cwd
    });
    expect(create.status).toBe(0);
    expect(await fs.readFile(agentsPath, "utf8")).toContain("<!-- sift:begin codex -->");

    await fs.writeFile(
      claudePath,
      "# Existing instructions\n\nKeep this.\n",
      "utf8"
    );

    const append = runSourceCli({
      args: ["agent", "install", "claude", "--yes"],
      cwd
    });
    expect(append.status).toBe(0);
    const appended = await fs.readFile(claudePath, "utf8");
    expect(appended).toContain("# Existing instructions");
    expect(appended).toContain("Keep this.");
    expect(appended).toContain("<!-- sift:begin claude -->");

    const update = runSourceCli({
      args: ["agent", "install", "claude", "--yes"],
      cwd
    });
    expect(update.status).toBe(0);
    const updated = await fs.readFile(claudePath, "utf8");
    expect(updated.match(/<!-- sift:begin claude -->/g)?.length ?? 0).toBe(1);

    const status = runSourceCli({
      args: ["agent", "status"],
      cwd
    });
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("Codex managed block: installed");
    expect(status.stdout).toContain("Claude managed block: installed");

    const remove = runSourceCli({
      args: ["agent", "remove", "claude", "--yes"],
      cwd
    });
    expect(remove.status).toBe(0);
    expect(await fs.readFile(claudePath, "utf8")).toBe("# Existing instructions\n\nKeep this.\n");
  });

  it("supports global installs under an isolated HOME and keeps dry-run non-mutating", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-agent-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-agent-cwd-"));
    const codexGlobalPath = path.join(home, ".codex", "AGENTS.md");
    const claudeGlobalPath = path.join(home, ".claude", "CLAUDE.md");

    const dryRun = runSourceCli({
      args: ["agent", "install", "codex", "--scope", "global", "--dry-run"],
      cwd,
      env: {
        HOME: home
      }
    });
    const dryRunRaw = runSourceCli({
      args: ["agent", "install", "codex", "--scope", "global", "--dry-run", "--raw"],
      cwd,
      env: {
        HOME: home
      }
    });
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain("Dry run: create Codex managed block");
    expect(dryRun.stdout).toContain("Use --raw to print the exact content that would be written.");
    expect(dryRun.stdout).not.toContain("<!-- sift:begin codex -->");
    expect(dryRunRaw.status).toBe(0);
    expect(dryRunRaw.stdout).toContain("<!-- sift:begin codex -->");
    await expect(fs.stat(codexGlobalPath)).rejects.toThrow();

    const install = runSourceCli({
      args: ["agent", "install", "claude", "--scope", "global", "--yes"],
      cwd,
      env: {
        HOME: home
      }
    });
    expect(install.status).toBe(0);
    expect(await fs.readFile(claudeGlobalPath, "utf8")).toContain("<!-- sift:begin claude -->");

    const status = runSourceCli({
      args: ["agent", "status"],
      cwd,
      env: {
        HOME: home
      }
    });
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(codexGlobalPath);
    expect(status.stdout).toContain(claudeGlobalPath);
  });

  it("fails safely for non-interactive writes without --yes and for malformed duplicate blocks", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-agent-safe-"));
    const agentsPath = path.join(cwd, "AGENTS.md");
    await fs.writeFile(
      agentsPath,
      [
        "# Notes",
        "",
        "<!-- sift:begin codex -->",
        "managed one",
        "<!-- sift:end codex -->",
        "",
        "<!-- sift:begin codex -->",
        "managed two",
        "<!-- sift:end codex -->"
      ].join("\n"),
      "utf8"
    );

    const nonInteractive = runSourceCli({
      args: ["agent", "install", "claude"],
      cwd
    });
    expect(nonInteractive.status).toBe(1);
    expect(nonInteractive.stderr).toContain("sift agent install requires --yes in non-interactive mode.");

    const malformed = runSourceCli({
      args: ["agent", "install", "codex", "--yes"],
      cwd
    });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("Found malformed or duplicate managed blocks for codex");

    const removeMalformed = runSourceCli({
      args: ["agent", "remove", "codex", "--yes"],
      cwd
    });
    expect(removeMalformed.status).toBe(1);
    expect(removeMalformed.stderr).toContain("Found malformed or duplicate managed blocks for codex");
  });

  it("supports explicit path overrides", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-agent-path-"));
    const targetPath = path.join(cwd, "nested", "custom.md");

    const install = runSourceCli({
      args: ["agent", "install", "codex", "--path", targetPath, "--yes"],
      cwd
    });
    expect(install.status).toBe(0);
    expect(await fs.readFile(targetPath, "utf8")).toContain("<!-- sift:begin codex -->");

    const remove = runSourceCli({
      args: ["agent", "remove", "codex", "--path", targetPath, "--yes"],
      cwd
    });
    expect(remove.status).toBe(0);
    expect(await fs.readFile(targetPath, "utf8")).toBe("");
  });

  it("keeps filesystem writes isolated from the real repo and home", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-agent-home-iso-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-agent-cwd-iso-"));
    const repoAgentsPath = path.join(repoRoot(), "AGENTS.md");
    const repoAgentsBefore = await fs
      .readFile(repoAgentsPath, "utf8")
      .then((content) => ({ exists: true as const, content }))
      .catch(() => ({ exists: false as const, content: "" }));

    const result = await runSourceCliAsync({
      args: ["agent", "install", "codex", "--scope", "global", "--yes"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(path.join(home, ".codex", "AGENTS.md"));
    await expect(fs.stat(path.join(home, ".codex", "AGENTS.md"))).resolves.toBeDefined();
    const repoAgentsAfter = await fs
      .readFile(repoAgentsPath, "utf8")
      .then((content) => ({ exists: true as const, content }))
      .catch(() => ({ exists: false as const, content: "" }));
    expect(repoAgentsAfter).toEqual(repoAgentsBefore);
  });
});
