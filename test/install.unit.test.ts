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
        "Codex   (AGENTS.md / ~/.codex/AGENTS.md)",
        `Global (${path.join(homeDir, ".codex", "AGENTS.md")}) - available in all projects`
      ]
    });

    const status = await installRuntimeSupport({
      io,
      cwd,
      homeDir,
      version: "0.4.4"
    });

    const written = await fs.readFile(path.join(homeDir, ".codex", "AGENTS.md"), "utf8");

    expect(status).toBe(0);
    expect(written).toContain("<!-- sift:begin codex -->");
    expect(io.stdout).toContain("███████╗██╗███████╗████████╗");
    expect(io.stdout).toContain("Which runtime(s) would you like to install for?");
    expect(io.stdout).toContain("Where would you like to install?");
    expect(io.stdout).toContain("Installed runtime support.");
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
      version: "0.4.4"
    });

    expect(status).toBe(0);
    expect(await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8")).toContain(
      "<!-- sift:begin codex -->"
    );
    expect(await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8")).toContain(
      "<!-- sift:begin claude -->"
    );
    expect(io.stdout).toContain("Codex + Claude");
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
      version: "0.4.4"
    });

    expect(status).toBe(1);
    expect(io.stderr).toContain("sift install is interactive and requires a TTY");
  });
});
