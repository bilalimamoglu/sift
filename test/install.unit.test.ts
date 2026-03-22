import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installRuntimeSupport,
  normalizeInstallRuntime,
  normalizeInstallScope,
  type InstallRuntimeIO
} from "../src/commands/install.js";
import { PROMPT_BACK } from "../src/ui/terminal.js";

function createFakeIO(args: {
  answers?: string[];
  selections?: string[];
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
} = {}): InstallRuntimeIO & {
  stdout: string;
  stderr: string;
  closed: boolean;
} {
  const answers = [...(args.answers ?? [])];
  const selections = [...(args.selections ?? [])];
  let stdout = "";
  let stderr = "";
  let closed = false;

  return {
    stdinIsTTY: args.stdinIsTTY ?? true,
    stdoutIsTTY: args.stdoutIsTTY ?? true,
    ask(prompt: string) {
      stdout += prompt;
      return Promise.resolve(answers.shift() ?? "");
    },
    select(prompt: string, _options: string[], selectedLabel?: string) {
      const value = selections.shift() ?? "";
      stdout += `${prompt}\n`;
      if (value) {
        stdout += `${selectedLabel ?? "Selected"}: ${value}\n`;
      }
      return Promise.resolve(value);
    },
    write(message: string) {
      stdout += message;
    },
    error(message: string) {
      stderr += message;
    },
    close() {
      closed = true;
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get closed() {
      return closed;
    }
  };
}

describe("install runtime support", () => {
  it("normalizes runtime and scope aliases", () => {
    expect(normalizeInstallRuntime(undefined)).toBeUndefined();
    expect(normalizeInstallRuntime("codex")).toBe("codex");
    expect(normalizeInstallRuntime("claude")).toBe("claude");
    expect(normalizeInstallRuntime("all")).toBe("all");
    expect(() => normalizeInstallRuntime("cursor")).toThrow(
      "Invalid runtime. Use codex, claude, or all."
    );

    expect(normalizeInstallScope(undefined)).toBeUndefined();
    expect(normalizeInstallScope("local")).toBe("repo");
    expect(normalizeInstallScope("repo")).toBe("repo");
    expect(normalizeInstallScope("global")).toBe("global");
    expect(() => normalizeInstallScope("machine")).toThrow(
      "Invalid --scope value. Use local or global."
    );
  });

  it("runs the interactive flow with banner, runtime selection, and global install", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-cwd-"));
    const io = createFakeIO({
      selections: [
        "Codex   (AGENTS.md / ~/.codex/AGENTS.md) - first-class if you live in Codex",
        "With an agent - best if Codex or Claude is already with you; sift goes first, the agent handles the weird leftovers",
        `Global (${path.join(homeDir, ".codex", "AGENTS.md")}) - use this if you want sift ready everywhere`
      ]
    });

    const status = await installRuntimeSupport({
      io,
      cwd,
      homeDir,
      version: "0.4.5"
    });

    const written = await fs.readFile(path.join(homeDir, ".codex", "AGENTS.md"), "utf8");

    expect(status).toBe(0);
    expect(written).toContain("<!-- sift:begin codex -->");
    expect(io.stdout).toContain("███████╗██╗███████╗████████╗");
    expect(io.stdout).toContain("Choose your runtime");
    expect(io.stdout).toContain("Choose how sift should work");
    expect(io.stdout).toContain("Choose where to install the runtime support");
    expect(io.stdout).toContain("Installed runtime support.");
    expect(io.stdout).toContain("Operating mode: Agent escalation");
    expect(io.stdout).toContain("sift doctor");
    expect(io.stdout).toContain("sift config setup");
    expect(io.closed).toBe(true);
  });

  it("installs all runtimes into the local repo when requested directly", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-local-"));
    const io = createFakeIO();

    const status = await installRuntimeSupport({
      runtime: "all",
      scope: "repo",
      yes: true,
      io,
      cwd,
      version: "0.4.5"
    });

    expect(status).toBe(0);
    expect(await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8")).toContain(
      "<!-- sift:begin codex -->"
    );
    expect(await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8")).toContain(
      "<!-- sift:begin claude -->"
    );
    expect(io.stdout).toContain("Codex + Claude");
    expect(io.stdout).toContain("Operating mode: Agent escalation");
  });

  it("continues straight into provider setup when provider-assisted is selected", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-provider-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-provider-cwd-"));
    const io = createFakeIO({
      answers: ["sk-install-key"],
      selections: [
        "Codex   (AGENTS.md / ~/.codex/AGENTS.md) - first-class if you live in Codex",
        "With provider fallback - recommended if you want sift to finish more ambiguous cases on its own before handing them back to you or your agent; needs an API key, cheap model only when needed",
        `Global (${path.join(homeDir, ".codex", "AGENTS.md")}) - use this if you want sift ready everywhere`,
        "OpenAI",
        "gpt-5-nano - default, cheapest, fast enough for most fallback passes"
      ]
    });

    const status = await installRuntimeSupport({
      io,
      cwd,
      homeDir,
      version: "0.4.5"
    });

    const configPath = path.join(homeDir, ".config", "sift", "config.yaml");
    const config = await fs.readFile(configPath, "utf8");

    expect(status).toBe(0);
    expect(config).toContain("operationMode: provider-assisted");
    expect(config).toContain("model: gpt-5-nano");
    expect(io.stdout).toContain("Next: provider setup. Press Esc at any step to go back.");
    expect(io.stdout).toContain("Selected model: gpt-5-nano");
    expect(io.stdout).toContain("sift config show --show-secrets");
    expect(io.stdout).not.toContain("sift config setup  # optional");
  });

  it("lets the user back out from mode to runtime and cancel before writing files", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-back-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-back-cwd-"));
    const io = createFakeIO({
      selections: [
        "Codex   (AGENTS.md / ~/.codex/AGENTS.md) - first-class if you live in Codex",
        PROMPT_BACK,
        PROMPT_BACK
      ]
    });

    const status = await installRuntimeSupport({
      io,
      cwd,
      homeDir,
      version: "0.4.5"
    });

    await expect(fs.access(path.join(homeDir, ".codex", "AGENTS.md"))).rejects.toThrow();
    expect(status).toBe(0);
    expect(io.stdout).toContain("Install canceled before we touched anything.");
  });

  it("fails clearly in non-interactive mode without enough inputs", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-install-non-tty-"));
    const io = createFakeIO({
      stdinIsTTY: false,
      stdoutIsTTY: false
    });

    const status = await installRuntimeSupport({
      io,
      cwd,
      version: "0.4.5"
    });

    expect(status).toBe(1);
    expect(io.stderr).toContain("sift install is interactive and requires a TTY");
  });
});
