import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG_FILENAME } from "../src/constants.js";
import { findConfigPath, loadRawConfig } from "../src/config/load.js";
import { defaultConfig } from "../src/config/defaults.js";
import { writeConfigFile, writeExampleConfig } from "../src/config/write.js";

describe("config filesystem helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("findConfigPath resolves explicit paths and throws when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-find-config-"));
    const configPath = path.join(tmpDir, "sift.config.yaml");
    fs.writeFileSync(configPath, "provider:\n  provider: openai\n", "utf8");

    expect(findConfigPath(configPath)).toBe(configPath);
    expect(() => findConfigPath(path.join(tmpDir, "missing.yaml"))).toThrow(
      "Config file not found"
    );
  });

  it("findConfigPath discovers the first default config in cwd", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-find-default-"));
    const previousCwd = process.cwd();
    const configPath = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, "provider:\n  provider: openai\n", "utf8");

    try {
      process.chdir(tmpDir);
      expect(fs.realpathSync(findConfigPath()!)).toBe(fs.realpathSync(configPath));
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("loadRawConfig returns defaults object shape when no config exists and handles null yaml", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-load-raw-"));
    const previousCwd = process.cwd();
    const previousHome = process.env.HOME;
    const configPath = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, "null", "utf8");

    try {
      process.env.HOME = tmpDir;
      process.chdir(tmpDir);
      expect(loadRawConfig()).toEqual({});
      fs.unlinkSync(configPath);
      expect(loadRawConfig()).toEqual({});
    } finally {
      process.env.HOME = previousHome;
      process.chdir(previousCwd);
    }
  });

  it("writeExampleConfig rejects conflicting options and existing files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-write-example-"));
    const targetPath = path.join(tmpDir, "example.yaml");
    fs.writeFileSync(targetPath, "existing: true\n", "utf8");

    expect(() =>
      writeExampleConfig({ global: true, targetPath })
    ).toThrow("Use either --path <path> or --global, not both.");
    expect(() => writeExampleConfig({ targetPath })).toThrow(
      `Config file already exists at ${targetPath}`
    );
  });

  it("writeExampleConfig writes the default config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-write-example-ok-"));
    const targetPath = path.join(tmpDir, "example.yaml");
    const writtenPath = writeExampleConfig({ targetPath });
    const mode = fs.statSync(targetPath).mode & 0o777;

    expect(writtenPath).toBe(targetPath);
    expect(fs.readFileSync(targetPath, "utf8")).toContain("provider:");
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
  });

  it("writeExampleConfig tolerates chmod failures after writing securely", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-write-example-chmod-"));
    const targetPath = path.join(tmpDir, "example.yaml");
    const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw new Error("chmod unsupported");
    });

    const writtenPath = writeExampleConfig({ targetPath });

    expect(writtenPath).toBe(targetPath);
    expect(fs.readFileSync(targetPath, "utf8")).toContain("provider:");
    expect(chmodSpy).toHaveBeenCalled();
  });

  it("writeExampleConfig supports default and global destinations", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-write-example-defaults-"));
    const previousCwd = process.cwd();
    const previousHome = process.env.HOME;

    try {
      process.chdir(tmpDir);
      process.env.HOME = tmpDir;

      const localPath = writeExampleConfig();
      const globalPath = writeExampleConfig({ global: true });

      expect(fs.realpathSync(localPath)).toBe(
        fs.realpathSync(path.join(tmpDir, DEFAULT_CONFIG_FILENAME))
      );
      expect(fs.realpathSync(globalPath)).toBe(
        fs.realpathSync(path.join(tmpDir, ".config", "sift", "config.yaml"))
      );
      expect(fs.existsSync(localPath)).toBe(true);
      expect(fs.existsSync(globalPath)).toBe(true);
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
    }
  });

  it("writeConfigFile enforces overwrite and tolerates chmod failures", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-write-config-"));
    const targetPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(targetPath, "existing: true\n", "utf8");

    expect(() =>
      writeConfigFile({ targetPath, config: defaultConfig })
    ).toThrow(`Config file already exists at ${targetPath}`);

    const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw new Error("chmod unsupported");
    });

    const writtenPath = writeConfigFile({
      targetPath,
      config: defaultConfig,
      overwrite: true
    });

    expect(writtenPath).toBe(targetPath);
    expect(fs.readFileSync(targetPath, "utf8")).toContain("gpt-5-nano");
    expect(chmodSpy).toHaveBeenCalled();
  });
});
