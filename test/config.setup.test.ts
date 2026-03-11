import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it, vi } from "vitest";
import {
  createTerminalIO,
  configSetup,
  resolveSetupPath,
  type ConfigSetupIO
} from "../src/commands/config-setup.js";
import { getDefaultGlobalConfigPath } from "../src/constants.js";

function createFakeIO(answers: string[]): ConfigSetupIO & {
  stdout: string;
  stderr: string;
  closed: boolean;
} {
  const queue = [...answers];
  let stdout = "";
  let stderr = "";
  let closed = false;

  return {
    stdinIsTTY: true,
    stdoutIsTTY: true,
    async ask(prompt: string) {
      stdout += prompt;
      return queue.shift() ?? "";
    },
    async secret(prompt: string) {
      stdout += prompt;
      return queue.shift() ?? "";
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

describe("config setup", () => {
  it("resolves the global path by default", () => {
    expect(resolveSetupPath()).toBe(getDefaultGlobalConfigPath());
  });

  it("writes an OpenAI config to an explicit path", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-"));
    const targetPath = path.join(dir, "custom-config.yaml");
    const io = createFakeIO(["", "sk-test-key"]);

    const status = await configSetup({
      targetPath,
      io
    });

    const written = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; model: string; baseUrl: string; apiKey: string };
    };
    const mode = fs.statSync(targetPath).mode & 0o777;

    expect(status).toBe(0);
    expect(written.provider.provider).toBe("openai");
    expect(written.provider.model).toBe("gpt-5-nano");
    expect(written.provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(written.provider.apiKey).toBe("sk-test-key");
    expect(io.stdout).toContain("Welcome to sift.");
    expect(io.stdout).toContain("Using OpenAI defaults for your first run.");
    expect(io.stdout).toContain("Enter your OpenAI API key (input hidden):");
    expect(io.stdout).toContain(`Machine-wide config: ${targetPath}`);
    expect(io.stdout).toContain("Want to switch providers or tweak defaults later?");
    expect(io.stdout).toContain("Want to inspect the active values first?");
    expect(io.stdout).not.toContain("sk-test-key");
    expect(io.closed).toBe(true);
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
  });

  it("accepts the interactive selector returning OpenAI directly", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-select-openai-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["sk-test-key"]);
    io.select = async () => "OpenAI";

    const status = await configSetup({
      targetPath,
      io
    });

    expect(status).toBe(0);
    expect(io.stdout).not.toContain("Provider [OpenAI]: ");
  });

  it("re-prompts when the API key is empty", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["", "", "sk-real-key"]);

    const status = await configSetup({
      targetPath,
      io
    });

    const written = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { apiKey: string };
    };

    expect(status).toBe(0);
    expect(io.stderr).toContain("API key cannot be empty.");
    expect(written.provider.apiKey).toBe("sk-real-key");
  });

  it("asks before overwriting an existing file", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-"));
    const targetPath = path.join(dir, "config.yaml");
    await fsPromises.writeFile(targetPath, "provider:\n  apiKey: old\n", "utf8");

    const denyOverwrite = createFakeIO(["n"]);
    const deniedStatus = await configSetup({
      targetPath,
      io: denyOverwrite
    });
    const unchanged = await fsPromises.readFile(targetPath, "utf8");

    const allowOverwrite = createFakeIO(["y", "", "sk-new-key"]);
    const allowedStatus = await configSetup({
      targetPath,
      io: allowOverwrite
    });
    const overwritten = YAML.parse(
      await fsPromises.readFile(targetPath, "utf8")
    ) as { provider: { apiKey: string } };

    expect(deniedStatus).toBe(1);
    expect(denyOverwrite.stdout).toContain("Overwrite? [y/N]");
    expect(denyOverwrite.stdout).toContain("Aborted.");
    expect(unchanged).toContain("old");

    expect(allowedStatus).toBe(0);
    expect(overwritten.provider.apiKey).toBe("sk-new-key");
  });

  it("falls back to typed provider input and re-prompts on invalid provider answers", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-provider-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["not-openai", "", "sk-test-key"]);
    delete io.select;

    const status = await configSetup({
      targetPath,
      io
    });

    expect(status).toBe(0);
    expect(io.stderr).toContain("Only OpenAI is supported in guided setup right now.");
    expect(io.stdout).toContain("Provider [OpenAI]: ");
  });

  it("falls back to typed provider input when the selector returns an unexpected value", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-select-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["openai", "sk-test-key"]);
    io.select = async () => "unexpected-provider";

    const status = await configSetup({
      targetPath,
      io
    });

    expect(status).toBe(0);
    expect(io.stdout).toContain("Provider [OpenAI]: ");
  });

  it("falls back to visible input when no secret prompt helper is available", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-visible-secret-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["", "sk-from-ask"]);
    delete io.secret;

    const status = await configSetup({
      targetPath,
      io
    });

    const written = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { apiKey: string };
    };

    expect(status).toBe(0);
    expect(io.stdout).toContain("Enter your OpenAI API key:");
    expect(written.provider.apiKey).toBe("sk-from-ask");
  });

  it("re-prompts on invalid overwrite answers", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-overwrite-"));
    const targetPath = path.join(dir, "config.yaml");
    await fsPromises.writeFile(targetPath, "provider:\n  apiKey: old\n", "utf8");
    const io = createFakeIO(["maybe", "yes", "", "sk-overwrite"]);

    const status = await configSetup({
      targetPath,
      io
    });

    const overwritten = YAML.parse(
      await fsPromises.readFile(targetPath, "utf8")
    ) as { provider: { apiKey: string } };

    expect(status).toBe(0);
    expect(io.stderr).toContain("Please answer y or n.");
    expect(overwritten.provider.apiKey).toBe("sk-overwrite");
  });

  it("fails clearly without a TTY", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-"));
    const targetPath = path.join(dir, "config.yaml");
    const io: ConfigSetupIO = {
      stdinIsTTY: false,
      stdoutIsTTY: false,
      async ask() {
        return "";
      },
      write() {},
      error() {}
    };

    const status = await configSetup({
      targetPath,
      io
    });

    expect(status).toBe(1);
    await expect(fsPromises.access(targetPath)).rejects.toThrow();
  });

  it("uses the default terminal IO path when no custom IO is supplied", async () => {
    vi.resetModules();
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const originalStdoutTTY = process.stdout.isTTY;
    const originalStdinTTY = process.stdin.isTTY;

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false
    });

    try {
      const mod = await import("../src/commands/config-setup.js");
      await expect(mod.configSetup()).resolves.toBe(1);
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("requires a TTY")
      );
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: originalStdoutTTY
      });
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalStdinTTY
      });
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }
  });

  it("creates terminal IO helpers lazily", async () => {
    const askMock = vi.fn().mockResolvedValue("value");
    const closeMock = vi.fn();
    const promptSelectMock = vi.fn().mockResolvedValue("OpenAI");
    const promptSecretMock = vi.fn().mockResolvedValue("secret");

    vi.resetModules();
    vi.doMock("node:readline/promises", () => ({
      createInterface: vi.fn(() => ({
        question: askMock,
        close: closeMock
      }))
    }));
    vi.doMock("../src/ui/terminal.js", () => ({
      promptSelect: promptSelectMock,
      promptSecret: promptSecretMock
    }));

    const { createTerminalIO: createIsolatedTerminalIO } = await import(
      "../src/commands/config-setup.js"
    );
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const io = createIsolatedTerminalIO();
      await expect(io.ask("Question? ")).resolves.toBe("value");
      await expect(io.select?.("Provider", ["OpenAI"])).resolves.toBe("OpenAI");
      await expect(io.secret?.("Secret: ")).resolves.toBe("secret");
      io.write("hello");
      io.error("oops");
      io.close?.();

      expect(askMock).toHaveBeenCalledWith("Question? ");
      expect(promptSelectMock).toHaveBeenCalled();
      expect(promptSecretMock).toHaveBeenCalled();
      expect(closeMock).toHaveBeenCalled();
      expect(stdoutWrite).toHaveBeenCalledWith("hello");
      expect(stderrWrite).toHaveBeenCalledWith("oops");
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }
  });

  it("warns when a repo-local config overrides the machine-wide config", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-"));
    const repoDir = path.join(dir, "repo");
    await fsPromises.mkdir(repoDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(repoDir, "sift.config.yaml"),
      "provider:\n  provider: openai-compatible\n",
      "utf8"
    );
    const targetPath = path.join(dir, ".config", "sift", "config.yaml");
    const io = createFakeIO(["", "sk-test-key"]);
    const previousCwd = process.cwd();

    process.chdir(repoDir);

    try {
      const status = await configSetup({
        targetPath,
        io
      });
      const expectedOverridePath = await fsPromises.realpath(
        path.join(repoDir, "sift.config.yaml")
      );

      expect(status).toBe(0);
      expect(io.stdout).toContain(
        `Heads-up: ${expectedOverridePath} currently overrides this machine-wide config in this directory.`
      );
    } finally {
      process.chdir(previousCwd);
    }
  });
});
