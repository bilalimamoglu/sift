import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import stripAnsi from "strip-ansi";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectAgentStatus,
  getManagedBlockMarkers,
  inspectManagedBlock,
  installAgent,
  normalizeAgentName,
  normalizeAgentScope,
  planManagedInstall,
  planManagedRemove,
  removeAgent,
  renderManagedBlock,
  resolveAgentTargetPath,
  showAgent,
  statusAgents,
  type AgentCommandIO
} from "../src/commands/agent.js";

function createIo(args: {
  answers?: string[];
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
} = {}): AgentCommandIO & { stdout: string; stderr: string } {
  const answers = [...(args.answers ?? [])];
  let stdout = "";
  let stderr = "";

  return {
    stdinIsTTY: args.stdinIsTTY ?? true,
    stdoutIsTTY: args.stdoutIsTTY ?? true,
    async ask(_prompt: string) {
      return answers.shift() ?? "";
    },
    write(message: string) {
      stdout += message;
    },
    error(message: string) {
      stderr += message;
    },
    close() {},
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}

describe("agent command helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes agent names and scopes", () => {
    expect(normalizeAgentName("codex")).toBe("codex");
    expect(normalizeAgentName("claude")).toBe("claude");
    expect(() => normalizeAgentName("cursor")).toThrow("Unknown agent: cursor");

    expect(normalizeAgentScope(undefined)).toBeUndefined();
    expect(normalizeAgentScope("repo")).toBe("repo");
    expect(normalizeAgentScope("global")).toBe("global");
    expect(() => normalizeAgentScope("machine")).toThrow(
      "Invalid --scope value. Use repo or global."
    );
  });

  it("resolves repo, global, and explicit target paths", () => {
    expect(
      resolveAgentTargetPath({
        agent: "codex",
        cwd: "/tmp/example-repo"
      })
    ).toBe("/tmp/example-repo/AGENTS.md");

    expect(
      resolveAgentTargetPath({
        agent: "claude",
        scope: "global",
        homeDir: "/tmp/example-home"
      })
    ).toBe("/tmp/example-home/.claude/CLAUDE.md");

    expect(
      resolveAgentTargetPath({
        agent: "codex",
        scope: "global",
        targetPath: "../custom/AGENTS.md",
        cwd: "/tmp/example-repo"
      })
    ).toBe(path.resolve("/tmp/example-repo", "../custom/AGENTS.md"));

    vi.spyOn(os, "homedir").mockReturnValue("/tmp/default-home");
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/default-cwd");
    expect(
      resolveAgentTargetPath({
        agent: "claude",
        scope: "global"
      })
    ).toBe("/tmp/default-home/.claude/CLAUDE.md");
    expect(
      resolveAgentTargetPath({
        agent: "codex"
      })
    ).toBe("/tmp/default-cwd/AGENTS.md");
  });

  it("renders managed blocks and inspects malformed markers", () => {
    const markers = getManagedBlockMarkers("codex");
    const block = renderManagedBlock("codex");

    expect(markers.start).toBe("<!-- sift:begin codex -->");
    expect(markers.end).toBe("<!-- sift:end codex -->");
    expect(block).toContain(markers.start);
    expect(block).toContain("Default operating mode: Agent escalation.");
    expect(block).toContain("Use `sift exec` first for long, noisy, non-interactive output.");
    expect(block).toContain("If exact raw output is required, skip `sift` and read the raw output directly.");
    expect(block).toContain("For test failures, start with `sift exec --preset test-status -- <test command>`.");
    expect(block).toContain("Read `SIFT.md` for the full workflow, rerun/escalate path, and diagnose JSON notes.");
    expect(block).toContain(markers.end);

    expect(inspectManagedBlock("", "codex")).toMatchObject({
      found: false,
      ambiguous: false,
      beginMatches: 0,
      endMatches: 0
    });

    expect(inspectManagedBlock(block, "codex")).toMatchObject({
      found: true,
      ambiguous: false,
      beginMatches: 1,
      endMatches: 1
    });

    expect(
      inspectManagedBlock(`${block}\n${block}`, "codex").ambiguous
    ).toBe(true);
    expect(
      inspectManagedBlock("<!-- sift:begin codex -->", "codex").ambiguous
    ).toBe(true);
    expect(
      inspectManagedBlock("<!-- sift:end codex -->\n<!-- sift:begin codex -->", "codex").ambiguous
    ).toBe(true);
  });

  it("plans create, append, update, and remove operations", () => {
    const createPlan = planManagedInstall({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md"
    });
    expect(createPlan.action).toBe("create");
    expect(createPlan.content).toContain("<!-- sift:begin codex -->");

    const appendPlan = planManagedInstall({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: "# Existing notes\n"
    });
    expect(appendPlan.action).toBe("append");
    expect(appendPlan.content).toContain("# Existing notes");
    expect(appendPlan.content).toContain("<!-- sift:begin codex -->");

    const appendFromEmptyString = planManagedInstall({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: ""
    });
    expect(appendFromEmptyString.action).toBe("append");
    expect(appendFromEmptyString.content).toContain("<!-- sift:begin codex -->");

    const appendWithoutTrailingNewline = planManagedInstall({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: "# Existing notes"
    });
    expect(appendWithoutTrailingNewline.content).toContain("# Existing notes\n\n<!-- sift:begin codex -->");

    const appendWithCrLf = planManagedInstall({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: "# Existing notes\r\n"
    });
    expect(appendWithCrLf.content).toContain("\r\n<!-- sift:begin codex -->");

    const current = `# Notes\n\n${renderManagedBlock("codex")}\n`;
    const updatePlan = planManagedInstall({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: current
    });
    expect(updatePlan.action).toBe("update");
    expect(updatePlan.content).toContain("# Notes");

    const unchangedRemoval = planManagedRemove({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: "# Notes\n"
    });
    expect(unchangedRemoval.changed).toBe(false);

    const removal = planManagedRemove({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: `# Notes\n\n${renderManagedBlock("codex")}\n\nKeep this.\n`
    });
    expect(removal.changed).toBe(true);
    expect(removal.content).toBe("# Notes\n\nKeep this.\n");

    const undefinedRemoval = planManagedRemove({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md"
    });
    expect(undefinedRemoval).toEqual({
      changed: false,
      content: "",
      block: renderManagedBlock("codex")
    });

    const removalFromTop = planManagedRemove({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: `${renderManagedBlock("codex")}\n\nKeep this.\n`
    });
    expect(removalFromTop.changed).toBe(true);
    expect(removalFromTop.content).toBe("Keep this.\n");

    const removalWithCrLf = planManagedRemove({
      agent: "codex",
      targetPath: "/tmp/AGENTS.md",
      existingContent: `# Notes\r\n\r\n${renderManagedBlock("codex", "\r\n")}\r\n`
    });
    expect(removalWithCrLf.changed).toBe(true);
    expect(removalWithCrLf.content).toBe("# Notes\r\n");

    expect(() =>
      planManagedInstall({
        agent: "codex",
        targetPath: "/tmp/AGENTS.md",
        existingContent: `${renderManagedBlock("codex")}\n${renderManagedBlock("codex")}`
      })
    ).toThrow("Found malformed or duplicate managed blocks for codex");
    expect(() =>
      planManagedRemove({
        agent: "codex",
        targetPath: "/tmp/AGENTS.md",
        existingContent: "<!-- sift:begin codex -->"
      })
    ).toThrow("Found malformed or duplicate managed blocks for codex");
  });

  it("shows the managed block and reports status across repo and global scopes", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-agent-status-repo-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sift-agent-status-home-"));
    fs.writeFileSync(path.join(cwd, "CLAUDE.md"), renderManagedBlock("claude"), "utf8");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "CLAUDE.md"),
      renderManagedBlock("claude"),
      "utf8"
    );

    const showIo = createIo();
    showAgent(
      {
        agent: "claude",
        cwd,
        homeDir: home,
        operationMode: "agent-escalation"
      },
      showIo
    );
    const previewOutput = stripAnsi(showIo.stdout);
    expect(previewOutput).toContain("Claude instructions preview");
    expect(previewOutput).toContain("status: managed block already installed here");
    expect(previewOutput).toContain("operation mode: Agent escalation");
    expect(previewOutput).toContain("Also installed in global scope");
    expect(previewOutput).toContain("This is only a preview. Nothing will be changed.");
    expect(previewOutput).toContain("Use --raw to print the exact managed block.");
    expect(previewOutput).toContain("target file: CLAUDE.md");
    expect(previewOutput).toContain("narrow long command output before your agent burns time and tokens on the raw log wall");
    expect(previewOutput).toContain("Default path: use `sift exec`");
    expect(previewOutput).toContain("Optional beta shortcut: use `sift hook`");
    expect(previewOutput).toContain("Shared guide:");
    expect(previewOutput).toContain("Claude also gets a tiny native command pack");
    expect(previewOutput).toContain("command pack target:");
    expect(previewOutput).toContain("Installed commands: /sift:help, /sift:test-status, /sift:doctor");
    expect(previewOutput).toContain("Read SIFT.md for the full workflow.");

    const rawShowIo = createIo({ stdoutIsTTY: false });
    showAgent({ agent: "claude", raw: true, operationMode: "agent-escalation" }, rawShowIo);
    expect(rawShowIo.stdout).toContain("<!-- sift:begin claude -->");
    expect(rawShowIo.stdout).toContain("Default operating mode: Agent escalation.");
    expect(rawShowIo.stdout).toContain("Use `sift exec` first for long, noisy, non-interactive output.");
    expect(rawShowIo.stdout).toContain("Read `SIFT.md` for the full workflow, rerun/escalate path, and diagnose JSON notes.");

    const pathShowIo = createIo();
    showAgent(
      {
        agent: "codex",
        scope: "repo",
        targetPath: "custom/AGENTS.md"
      },
      pathShowIo
    );
    const pathPreviewOutput = stripAnsi(pathShowIo.stdout);
    expect(pathPreviewOutput).toContain("target path:");
    expect(pathPreviewOutput).toContain(path.resolve(process.cwd(), "custom/AGENTS.md"));
    expect(pathPreviewOutput).toContain("status: not installed in this target yet");

    const globalShowIo = createIo();
    showAgent(
      {
        agent: "codex",
        scope: "global",
        cwd,
        homeDir: home
      },
      globalShowIo
    );
    const globalPreviewOutput = stripAnsi(globalShowIo.stdout);
    expect(globalPreviewOutput).toContain("scope: global");
    expect(globalPreviewOutput).toContain("status: not installed in this target yet");

    fs.writeFileSync(path.join(cwd, "AGENTS.md"), renderManagedBlock("codex"), "utf8");

    const rows = collectAgentStatus({
      cwd,
      homeDir: home
    });
    expect(rows).toContainEqual({
      agent: "codex",
      scope: "repo",
      targetPath: path.join(cwd, "AGENTS.md"),
      fileExists: true,
      installed: true
    });
    expect(rows).toContainEqual({
      agent: "claude",
      scope: "global",
      targetPath: path.join(home, ".claude", "CLAUDE.md"),
      fileExists: true,
      installed: true
    });

    const statusIo = createIo();
    statusAgents({
      cwd,
      homeDir: home,
      io: statusIo
    });
    expect(statusIo.stdout).toContain("Agent installer status");
    expect(statusIo.stdout).toContain("Codex managed block: installed");
    expect(statusIo.stdout).toContain("Claude managed block: installed");
    expect(statusIo.stdout).toContain("Claude command pack: not installed");
  });

  it("uses stdout when showAgent is called without a custom io", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    showAgent("codex");

    expect(stdoutSpy).toHaveBeenCalled();
    expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "Codex instructions preview"
    );
  });

  it("installs and removes managed blocks safely", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-agent-install-"));
    const targetPath = path.join(cwd, "AGENTS.md");

    const createOnlyIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "codex",
        cwd,
        io: createOnlyIo
      })
    ).resolves.toBe(1);
    expect(createOnlyIo.stderr).toContain("requires --yes in non-interactive mode");
    expect(fs.existsSync(targetPath)).toBe(false);

    const dryRunIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "codex",
        cwd,
        dryRun: true,
        io: dryRunIo
      })
    ).resolves.toBe(0);
    expect(dryRunIo.stdout).toContain("Dry run: create Codex managed block");
    expect(dryRunIo.stdout).toContain("Only the managed sift block would be written or updated.");
    expect(dryRunIo.stdout).toContain("Use --raw to print the exact content that would be written.");
    expect(dryRunIo.stdout).not.toContain("<!-- sift:begin codex -->");
    expect(fs.existsSync(targetPath)).toBe(false);

    const dryRunRawIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "codex",
        cwd,
        dryRun: true,
        raw: true,
        io: dryRunRawIo
      })
    ).resolves.toBe(0);
    expect(dryRunRawIo.stdout).toContain("<!-- sift:begin codex -->");
    expect(dryRunRawIo.stdout).not.toContain("Dry run:");

    const appendDryRunPath = path.join(cwd, "APPEND.md");
    fs.writeFileSync(appendDryRunPath, "# Existing notes\n", "utf8");
    const appendDryRunIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "codex",
        targetPath: appendDryRunPath,
        dryRun: true,
        io: appendDryRunIo
      })
    ).resolves.toBe(0);
    expect(appendDryRunIo.stdout).toContain("Dry run: append Codex managed block");
    expect(appendDryRunIo.stdout).toContain(
      "append the managed block and keep surrounding notes untouched"
    );

    const updateDryRunPath = path.join(cwd, "UPDATE.md");
    fs.writeFileSync(updateDryRunPath, renderManagedBlock("codex"), "utf8");
    const updateDryRunIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "codex",
        targetPath: updateDryRunPath,
        dryRun: true,
        scope: "global",
        io: updateDryRunIo
      })
    ).resolves.toBe(0);
    expect(updateDryRunIo.stdout).toContain("Dry run: update Codex managed block");
    expect(updateDryRunIo.stdout).toContain(
      "update only the existing managed block and keep surrounding notes untouched"
    );
    expect(updateDryRunIo.stdout).toContain(
      "Global scope writes to your machine-wide agent instructions."
    );

    const installIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "codex",
        cwd,
        yes: true,
        io: installIo
      })
    ).resolves.toBe(0);
    expect(installIo.stdout).toContain("This will only manage the sift block.");
    expect(installIo.stdout).toContain("Codex managed block updated.");
    expect(fs.readFileSync(targetPath, "utf8")).toContain("<!-- sift:begin codex -->");

    const globalInstallPath = path.join(cwd, "GLOBAL.md");
    const globalHome = fs.mkdtempSync(path.join(os.tmpdir(), "sift-agent-global-home-"));
    const globalInstallIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "claude",
        targetPath: globalInstallPath,
        scope: "global",
        homeDir: globalHome,
        yes: true,
        io: globalInstallIo
      })
    ).resolves.toBe(0);
    expect(globalInstallIo.stdout).toContain(
      "Global scope writes to your machine-wide agent instructions."
    );
    expect(
      fs.readFileSync(path.join(globalHome, ".claude", "commands", "sift", "help.md"), "utf8")
    ).toContain("/sift:help");

    const notFilePath = path.join(cwd, "not-a-file");
    fs.mkdirSync(notFilePath);
    await expect(
      installAgent({
        agent: "codex",
        targetPath: notFilePath,
        yes: true,
        io: createIo({ stdinIsTTY: false, stdoutIsTTY: false })
      })
    ).rejects.toThrow("exists but is not a file");

    const existingPath = path.join(cwd, "CLAUDE.md");
    fs.writeFileSync(existingPath, "# User content\n", "utf8");
    const appendIo = createIo({ answers: ["yes"] });
    await expect(
      installAgent({
        agent: "claude",
        targetPath: existingPath,
        cwd,
        io: appendIo
      })
    ).resolves.toBe(0);
    expect(fs.readFileSync(existingPath, "utf8")).toContain("# User content");
    expect(fs.readFileSync(existingPath, "utf8")).toContain("<!-- sift:begin claude -->");
    expect(
      fs.readFileSync(path.join(cwd, ".claude", "commands", "sift", "test-status.md"), "utf8")
    ).toContain("/sift:test-status");

    const updatePromptAsk = vi.fn().mockResolvedValue("yes");
    const updatePromptIo = {
      ...createIo(),
      ask: updatePromptAsk
    };
    await expect(
      installAgent({
        agent: "claude",
        targetPath: existingPath,
        cwd,
        io: updatePromptIo
      })
    ).resolves.toBe(0);
    expect(updatePromptAsk).toHaveBeenCalledWith(
      `Update the managed Claude block in ${existingPath}? Existing content outside the block will be preserved. [y/N]: `
    );

    const abortPath = path.join(cwd, "ABORT.md");
    fs.writeFileSync(abortPath, "# Existing\n", "utf8");
    const abortIo = createIo({ answers: ["no"] });
    await expect(
      installAgent({
        agent: "codex",
        targetPath: abortPath,
        io: abortIo
      })
    ).resolves.toBe(1);
    expect(abortIo.stdout).toContain("Aborted.");
    expect(fs.readFileSync(abortPath, "utf8")).toBe("# Existing\n");

    const removeIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      removeAgent({
        agent: "claude",
        targetPath: existingPath,
        cwd,
        yes: true,
        io: removeIo
      })
    ).resolves.toBe(0);
    expect(fs.readFileSync(existingPath, "utf8")).toBe("# User content\n");
    expect(fs.existsSync(path.join(cwd, ".claude", "commands", "sift", "help.md"))).toBe(false);

    const removeDryRunIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      removeAgent({
        agent: "codex",
        targetPath,
        dryRun: true,
        io: removeDryRunIo
      })
    ).resolves.toBe(0);
    expect(removeDryRunIo.stdout).toContain("Dry run: remove Codex managed block");
    expect(removeDryRunIo.stdout).toContain("Only the managed sift block would be removed.");

    const removeAbortIo = createIo({ answers: ["no"] });
    await expect(
      removeAgent({
        agent: "codex",
        targetPath,
        io: removeAbortIo
      })
    ).resolves.toBe(1);
    expect(removeAbortIo.stdout).toContain("Aborted.");

    const removeConfirmIo = createIo({ answers: ["yes"] });
    await expect(
      removeAgent({
        agent: "codex",
        targetPath,
        io: removeConfirmIo
      })
    ).resolves.toBe(0);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("");

    const noBlockIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      removeAgent({
        agent: "codex",
        targetPath,
        yes: true,
        io: noBlockIo
      })
    ).resolves.toBe(0);
    expect(noBlockIo.stdout).toContain("No managed Codex block found");
  });

  it("refuses to overwrite a custom Claude command file while leaving the managed block untouched", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-agent-claude-custom-"));
    const claudePath = path.join(cwd, "CLAUDE.md");
    const commandDir = path.join(cwd, ".claude", "commands", "sift");
    fs.mkdirSync(commandDir, { recursive: true });
    fs.writeFileSync(claudePath, "# User content\n", "utf8");
    fs.writeFileSync(path.join(commandDir, "help.md"), "# custom\n", "utf8");

    const io = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "claude",
        cwd,
        yes: true,
        io
      })
    ).resolves.toBe(1);

    expect(io.stderr).toContain("Refusing to overwrite a custom Claude command file");
    expect(fs.readFileSync(claudePath, "utf8")).toBe("# User content\n");
    expect(fs.readFileSync(path.join(commandDir, "help.md"), "utf8")).toBe("# custom\n");
  });

  it("covers default terminal IO branches without touching real user files", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sift-agent-default-"));
    const targetPath = path.join(cwd, "AGENTS.md");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      installAgent({
        agent: "codex",
        targetPath,
        dryRun: true,
        yes: true
      })
    ).resolves.toBe(0);

    fs.writeFileSync(targetPath, renderManagedBlock("codex"), "utf8");
    await expect(
      removeAgent({
        agent: "codex",
        targetPath
      })
    ).resolves.toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("sift agent remove requires --yes in non-interactive mode.\n")
    );

    statusAgents();
    expect(stdoutSpy).toHaveBeenCalled();
  });
});
