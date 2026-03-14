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
      providerProfiles?: { openai?: { apiKey?: string } };
    };
    const mode = fs.statSync(targetPath).mode & 0o777;

    expect(status).toBe(0);
    expect(written.provider.provider).toBe("openai");
    expect(written.provider.model).toBe("gpt-5-nano");
    expect(written.provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(written.provider.apiKey).toBe("sk-test-key");
    expect(written.providerProfiles?.openai?.apiKey).toBe("sk-test-key");
    expect(io.stdout).toContain("Welcome to sift.");
    expect(io.stdout).toContain("Using OpenAI defaults for your first run.");
    expect(io.stdout).toContain("Enter your OpenAI API key (input hidden):");
    expect(io.stdout).toContain(`Machine-wide config: ${targetPath}`);
    expect(io.stdout).toContain("Want to switch providers later?");
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
    expect(io.stdout).not.toContain("Provider [OpenAI/OpenRouter]: ");
  });

  it("writes an OpenRouter config when selected from the interactive selector", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-select-openrouter-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["or-key"]);
    io.select = async () => "OpenRouter";

    const status = await configSetup({
      targetPath,
      io
    });

    const written = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; model: string; baseUrl: string; apiKey: string };
      providerProfiles?: { openrouter?: { apiKey?: string } };
    };

    expect(status).toBe(0);
    expect(written.provider.provider).toBe("openrouter");
    expect(written.provider.model).toBe("openrouter/free");
    expect(written.provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(written.provider.apiKey).toBe("or-key");
    expect(written.providerProfiles?.openrouter?.apiKey).toBe("or-key");
    expect(io.stdout).toContain("Using OpenRouter defaults for your first run.");
    expect(io.stdout).toContain("Enter your OpenRouter API key (input hidden):");
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
      providerProfiles?: { openai?: { apiKey?: string } };
    };

    expect(status).toBe(0);
    expect(io.stderr).toContain("API key cannot be empty.");
    expect(written.provider.apiKey).toBe("sk-real-key");
    expect(written.providerProfiles?.openai?.apiKey).toBe("sk-real-key");
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
    expect(io.stderr).toContain(
      "Only OpenAI and OpenRouter are supported in guided setup right now."
    );
    expect(io.stdout).toContain("Provider [OpenAI/OpenRouter]: ");
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
    expect(io.stdout).toContain("Provider [OpenAI/OpenRouter]: ");
  });

  it("accepts typed OpenRouter input when the selector is unavailable", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-typed-openrouter-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["openrouter", "or-test-key"]);
    delete io.select;

    const status = await configSetup({
      targetPath,
      io
    });

    const written = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; apiKey: string };
    };

    expect(status).toBe(0);
    expect(io.stdout).toContain("Provider [OpenAI/OpenRouter]: ");
    expect(io.stdout).toContain("Enter your OpenRouter API key (input hidden):");
    expect(written.provider.provider).toBe("openrouter");
    expect(written.provider.apiKey).toBe("or-test-key");
  });

  it("updates an existing config without an overwrite prompt and preserves non-provider settings", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-update-"));
    const targetPath = path.join(dir, "config.yaml");
    await fsPromises.writeFile(
      targetPath,
      [
        "provider:",
        "  provider: openai",
        "  model: gpt-5-nano",
        "  baseUrl: https://api.openai.com/v1",
        "  apiKey: old-openai-key",
        "  timeoutMs: 33333",
        "  temperature: 0.1",
        "  maxOutputTokens: 400",
        "  jsonResponseFormat: auto",
        "input:",
        "  stripAnsi: true",
        "  redact: true",
        "  redactStrict: false",
        "  maxCaptureChars: 1234",
        "  maxInputChars: 5678",
        "  headChars: 100",
        "  tailChars: 100",
        "runtime:",
        "  rawFallback: false",
        "  verbose: true",
        "presets: {}"
      ].join("\n"),
      "utf8"
    );
    const io = createFakeIO(["openrouter", "or-new-key"]);
    delete io.select;

    const status = await configSetup({
      targetPath,
      io
    });

    const updated = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; apiKey: string; timeoutMs: number };
      input: { redact: boolean; maxCaptureChars: number };
      runtime: { rawFallback: boolean; verbose: boolean };
      providerProfiles: {
        openai?: { apiKey?: string };
        openrouter?: { apiKey?: string };
      };
    };

    expect(status).toBe(0);
    expect(io.stdout).toContain("Updating existing config");
    expect(io.stdout).not.toContain("Overwrite? [y/N]");
    expect(updated.provider.provider).toBe("openrouter");
    expect(updated.provider.apiKey).toBe("or-new-key");
    expect(updated.provider.timeoutMs).toBe(33333);
    expect(updated.input.redact).toBe(true);
    expect(updated.input.maxCaptureChars).toBe(1234);
    expect(updated.runtime.rawFallback).toBe(false);
    expect(updated.runtime.verbose).toBe(true);
    expect(updated.providerProfiles.openai?.apiKey).toBe("old-openai-key");
    expect(updated.providerProfiles.openrouter?.apiKey).toBe("or-new-key");
  });

  it("reuses a saved provider profile key when selected", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-saved-key-"));
    const targetPath = path.join(dir, "config.yaml");
    await fsPromises.writeFile(
      targetPath,
      [
        "provider:",
        "  provider: openai",
        "  model: gpt-5-nano",
        "  baseUrl: https://api.openai.com/v1",
        "  apiKey: old-openai-key",
        "providerProfiles:",
        "  openrouter:",
        "    model: openrouter/free",
        "    baseUrl: https://openrouter.ai/api/v1",
        "    apiKey: saved-openrouter-key",
        "presets: {}"
      ].join("\n"),
      "utf8"
    );
    const io = createFakeIO([]);
    io.select = vi
      .fn()
      .mockResolvedValueOnce("OpenRouter")
      .mockResolvedValueOnce("Use existing key");

    const status = await configSetup({
      targetPath,
      io
    });

    const updated = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; apiKey: string };
    };

    expect(status).toBe(0);
    expect(updated.provider.provider).toBe("openrouter");
    expect(updated.provider.apiKey).toBe("saved-openrouter-key");
    expect(io.stdout).not.toContain("Enter your OpenRouter API key");
  });

  it("reuses an environment key without writing it to config", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-env-key-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO([]);
    io.select = vi
      .fn()
      .mockResolvedValueOnce("OpenRouter")
      .mockResolvedValueOnce("Use existing key");

    const status = await configSetup({
      targetPath,
      io,
      env: {
        OPENROUTER_API_KEY: "env-openrouter-key"
      }
    });

    const updated = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; apiKey: string };
      providerProfiles: { openrouter?: { apiKey?: string } };
    };

    expect(status).toBe(0);
    expect(updated.provider.provider).toBe("openrouter");
    expect(updated.provider.apiKey).toBe("");
    expect(updated.providerProfiles.openrouter?.apiKey).toBeUndefined();
    expect(io.stdout).toContain("No API key was written to config");
  });

  it("lets the user choose between saved and environment keys", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-both-keys-"));
    const targetPath = path.join(dir, "config.yaml");
    await fsPromises.writeFile(
      targetPath,
      [
        "provider:",
        "  provider: openai",
        "  model: gpt-5-nano",
        "  baseUrl: https://api.openai.com/v1",
        "  apiKey: old-openai-key",
        "providerProfiles:",
        "  openrouter:",
        "    model: openrouter/free",
        "    baseUrl: https://openrouter.ai/api/v1",
        "    apiKey: saved-openrouter-key",
        "presets: {}"
      ].join("\n"),
      "utf8"
    );
    const io = createFakeIO([]);
    io.select = vi
      .fn()
      .mockResolvedValueOnce("OpenRouter")
      .mockResolvedValueOnce("Use env key");

    const status = await configSetup({
      targetPath,
      io,
      env: {
        OPENROUTER_API_KEY: "env-openrouter-key"
      }
    });

    const updated = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; apiKey: string };
      providerProfiles: { openrouter?: { apiKey?: string } };
    };

    expect(status).toBe(0);
    expect(updated.provider.provider).toBe("openrouter");
    expect(updated.provider.apiKey).toBe("");
    expect(updated.providerProfiles.openrouter?.apiKey).toBe("saved-openrouter-key");
    expect(io.stdout).toContain("No API key was written to config");
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

  it("uses an OpenRouter-specific visible prompt when no secret helper is available", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-visible-openrouter-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["openrouter", "or-from-ask"]);
    delete io.select;
    delete io.secret;

    const status = await configSetup({
      targetPath,
      io
    });

    const written = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { provider: string; apiKey: string };
    };

    expect(status).toBe(0);
    expect(io.stdout).toContain("Enter your OpenRouter API key:");
    expect(written.provider.provider).toBe("openrouter");
    expect(written.provider.apiKey).toBe("or-from-ask");
  });

  it("re-prompts on invalid api key choice answers", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sift-setup-key-choice-"));
    const targetPath = path.join(dir, "config.yaml");
    const io = createFakeIO(["openrouter", "maybe", "", "or-key"]);
    delete io.select;

    const status = await configSetup({
      targetPath,
      io,
      env: {
        OPENROUTER_API_KEY: "env-openrouter-key"
      }
    });

    const updated = YAML.parse(await fsPromises.readFile(targetPath, "utf8")) as {
      provider: { apiKey: string };
    };

    expect(status).toBe(0);
    expect(io.stderr).toContain("Please answer existing or override.");
    expect(updated.provider.apiKey).toBe("");
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
