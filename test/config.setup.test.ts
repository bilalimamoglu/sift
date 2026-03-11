import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import {
  configSetup,
  resolveSetupPath,
  type ConfigSetupIO
} from "../src/commands/config-setup.js";
import { getDefaultGlobalConfigPath } from "../src/constants.js";

function createFakeIO(answers: string[]): ConfigSetupIO & {
  stdout: string;
  stderr: string;
} {
  const queue = [...answers];
  let stdout = "";
  let stderr = "";

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
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
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
    expect(io.stdout).toContain("Using OpenAI defaults.");
    expect(io.stdout).toContain("Enter your OpenAI API key (input hidden):");
    expect(io.stdout).toContain(`Wrote machine-wide config to ${targetPath}`);
    expect(io.stdout).not.toContain("sk-test-key");
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
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
