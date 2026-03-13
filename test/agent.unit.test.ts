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
    expect(block).toContain("sift exec --preset test-status -- <test command>");
    expect(block).toContain("default to `sift` first and treat `standard` as the usual stop point");
    expect(block).toContain("Use `sift escalate` when you want a deeper render of the same cached output");
    expect(block).toContain("`sift escalate` and `sift rerun` require a cached `sift exec --preset test-status -- <test command>` run first.");
    expect(block).toContain("refresh the truth with `sift rerun`");
    expect(block).toContain("sift rerun --remaining --detail focused");
    expect(block).toContain("`sift rerun --remaining` currently supports only argv-mode `pytest ...` or `python -m pytest ...` runs;");
    expect(block).toContain("Use diagnose JSON only when automation or machine branching truly needs it.");
    expect(block).toContain(
      "If `standard` already shows bucket-level root cause, anchor, and fix lines, trust it and report from it directly."
    );
    expect(block).toContain(
      "do not re-verify the same bucket with raw pytest; at most do one targeted source read before you edit."
    );
    expect(block).toContain(
      "If `standard` still contains an unknown bucket or ends with `Decision: zoom`, do one deeper sift pass before raw traceback."
    );
    expect(block).toContain(
      "Diagnose JSON is summary-first by default. Add `--include-test-ids` only when you truly need the raw failing test IDs."
    );
    expect(block).toContain(
      "If diagnose JSON returns `read_targets.context_hint.start_line/end_line`, read only that small line range first."
    );
    expect(block).toContain(
      "If diagnose JSON returns only `read_targets.context_hint.search_hint`, search for that string in the target file before reading the whole file."
    );
    expect(block).toContain("--show-raw");
    expect(block).not.toContain("When debugging test failures, use this order:");
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
        homeDir: home
      },
      showIo
    );
    const previewOutput = stripAnsi(showIo.stdout);
    expect(previewOutput).toContain("Claude instructions preview");
    expect(previewOutput).toContain("status: managed block already installed here");
    expect(previewOutput).toContain("Also installed in global scope");
    expect(previewOutput).toContain("This is only a preview. Nothing will be changed.");
    expect(previewOutput).toContain("Use --raw to print the exact managed block.");
    expect(previewOutput).toContain("target file: CLAUDE.md");
    expect(previewOutput).toContain("context-window and token budget");
    expect(previewOutput).toContain("default to sift first, keep raw as the last resort");
    expect(previewOutput).toContain("standard should usually be enough for first-pass triage");
    expect(previewOutput).toContain("After a fix, refresh the truth with sift rerun");
    expect(previewOutput).toContain("Only then zoom into what is still broken");
    expect(previewOutput).toContain("Use diagnose JSON only for automation or machine branching");
    expect(previewOutput).toContain(
      "If standard already shows bucket-level root cause, anchor, and fix lines"
    );
    expect(previewOutput).toContain("avoid re-verifying the same bucket with raw pytest");

    const rawShowIo = createIo({ stdoutIsTTY: false });
    showAgent({ agent: "claude", raw: true }, rawShowIo);
    expect(rawShowIo.stdout).toContain("<!-- sift:begin claude -->");
    expect(rawShowIo.stdout).toContain("refresh the truth with `sift rerun`");
    expect(rawShowIo.stdout).toContain("`sift escalate` and `sift rerun` require a cached `sift exec --preset test-status -- <test command>` run first.");
    expect(rawShowIo.stdout).toContain("--include-test-ids");
    expect(rawShowIo.stdout).toContain("--show-raw");

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
    const globalInstallIo = createIo({ stdinIsTTY: false, stdoutIsTTY: false });
    await expect(
      installAgent({
        agent: "claude",
        targetPath: globalInstallPath,
        scope: "global",
        yes: true,
        io: globalInstallIo
      })
    ).resolves.toBe(0);
    expect(globalInstallIo.stdout).toContain(
      "Global scope writes to your machine-wide agent instructions."
    );

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
        io: appendIo
      })
    ).resolves.toBe(0);
    expect(fs.readFileSync(existingPath, "utf8")).toContain("# User content");
    expect(fs.readFileSync(existingPath, "utf8")).toContain("<!-- sift:begin claude -->");

    const updatePromptAsk = vi.fn().mockResolvedValue("yes");
    const updatePromptIo = {
      ...createIo(),
      ask: updatePromptAsk
    };
    await expect(
      installAgent({
        agent: "claude",
        targetPath: existingPath,
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
        yes: true,
        io: removeIo
      })
    ).resolves.toBe(0);
    expect(fs.readFileSync(existingPath, "utf8")).toBe("# User content\n");

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
