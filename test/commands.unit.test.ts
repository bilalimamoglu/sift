import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configInit,
  configShow,
  configValidate,
  maskConfigSecrets
} from "../src/commands/config.js";
import { runDoctor } from "../src/commands/doctor.js";
import { listPresets, showPreset } from "../src/commands/presets.js";
import { defaultConfig } from "../src/config/defaults.js";
import type { SiftConfig } from "../src/types.js";

function withPatchedStream(
  stream: NodeJS.WriteStream,
  values: Partial<NodeJS.WriteStream>,
  fn: () => void
): void {
  const originals = new Map<string, unknown>();

  for (const [key, value] of Object.entries(values)) {
    originals.set(key, ((stream as unknown) as Record<string, unknown>)[key]);
    Object.defineProperty(stream, key, {
      configurable: true,
      value
    });
  }

  try {
    fn();
  } finally {
    for (const [key, value] of originals) {
      Object.defineProperty(stream, key, {
        configurable: true,
        value
      });
    }
  }
}

function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    });
  const stderrWrite = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    });

  try {
    fn();
    return { stdout, stderr };
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}

function buildConfig(overrides: Partial<SiftConfig["provider"]> = {}): SiftConfig {
  return {
    ...defaultConfig,
    provider: {
      ...defaultConfig.provider,
      ...overrides
    }
  };
}

describe("command modules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("configInit prints only the path on non-tty stdout", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-config-init-"));
    const targetPath = path.join(tmpDir, "sift.config.yaml");

    const { stdout } = captureOutput(() => {
      withPatchedStream(process.stdout, { isTTY: false }, () => {
        configInit(targetPath);
      });
    });

    expect(stdout.trim()).toBe(targetPath);
    expect(fs.existsSync(targetPath)).toBe(true);
  });

  it("configInit prints a friendly tty success message", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-config-init-tty-"));
    const targetPath = path.join(tmpDir, "sift.config.yaml");

    const { stdout } = captureOutput(() => {
      withPatchedStream(process.stdout, { isTTY: true }, () => {
        configInit(targetPath, false);
      });
    });

    expect(stdout).toContain("Template config written");
    expect(stdout).toContain(targetPath);
  });

  it("configInit supports machine-wide template output and validate reports the resolved path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-config-global-"));
    const globalPath = path.join(tmpDir, ".config", "sift", "config.yaml");
    const originalHome = process.env.HOME;
    process.env.HOME = tmpDir;

    try {
      const initStdout = captureOutput(() => {
        withPatchedStream(process.stdout, { isTTY: true }, () => {
          configInit(undefined, true);
        });
      }).stdout;

      const validateStdout = captureOutput(() => {
        withPatchedStream(process.stdout, { isTTY: false }, () => {
          configValidate(globalPath);
        });
      }).stdout;

      expect(initStdout).toContain("Machine-wide config written");
      expect(initStdout).toContain(globalPath);
      expect(validateStdout).toContain(globalPath);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it("configShow masks secrets by default and reveals them when asked", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-config-show-"));
    const configPath = path.join(tmpDir, "sift.config.yaml");
    fs.writeFileSync(
      configPath,
      [
        "provider:",
        "  provider: openai",
        "  model: gpt-5-nano",
        "  baseUrl: https://api.openai.com/v1",
        "  apiKey: test-secret"
      ].join("\n"),
      "utf8"
    );

    const masked = captureOutput(() => {
      configShow(configPath, false);
    }).stdout;
    const revealed = captureOutput(() => {
      configShow(configPath, true);
    }).stdout;

    expect(masked).toContain('"apiKey": "***"');
    expect(revealed).toContain('"apiKey": "test-secret"');
  });

  it("maskConfigSecrets handles arrays and nested non-objects", () => {
    expect(
      maskConfigSecrets([
        {
          apiKey: "secret",
          nested: {
            apiKey: "nested-secret"
          }
        },
        "plain"
      ])
    ).toEqual([
      {
        apiKey: "***",
        nested: {
          apiKey: "***"
        }
      },
      "plain"
    ]);
  });

  it("configValidate prints tty and non-tty messages", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-config-validate-"));
    const configPath = path.join(tmpDir, "sift.config.yaml");
    fs.writeFileSync(configPath, "provider:\n  provider: openai\n", "utf8");

    const tty = captureOutput(() => {
      withPatchedStream(process.stdout, { isTTY: true }, () => {
        configValidate(configPath);
      });
    }).stdout;
    const plain = captureOutput(() => {
      withPatchedStream(process.stdout, { isTTY: false }, () => {
        configValidate(configPath);
      });
    }).stdout;

    expect(tty).toContain("Resolved config is valid");
    expect(plain).toContain("Resolved config is valid");
  });

  it("configValidate reports defaults when no config file is active", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-config-validate-defaults-"));
    const previousCwd = process.cwd();
    const previousHome = process.env.HOME;

    try {
      process.chdir(tmpDir);
      process.env.HOME = tmpDir;

      const plain = captureOutput(() => {
        withPatchedStream(process.stdout, { isTTY: false }, () => {
          configValidate();
        });
      }).stdout;

      expect(plain).toContain("Resolved config is valid (using defaults).");
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
    }
  });

  it("runDoctor prints config details and succeeds when complete", () => {
    const config = buildConfig({ apiKey: "secret" });

    const { stdout, stderr } = captureOutput(() => {
      const code = runDoctor(config, "/tmp/example.yaml");
      expect(code).toBe(0);
    });

    expect(stdout).toContain("configPath: /tmp/example.yaml");
    expect(stdout).toContain("apiKey: set");
    expect(stderr).toBe("");
  });

  it("runDoctor reports missing provider fields to stderr", () => {
    const config = buildConfig({ apiKey: "" });

    const { stdout, stderr } = captureOutput(() => {
      withPatchedStream(process.stderr, { isTTY: false }, () => {
        const code = runDoctor(config, null);
        expect(code).toBe(1);
      });
    });

    expect(stdout).toContain("apiKey: not set");
    expect(stderr).toContain("Missing provider.apiKey");
    expect(stderr).toContain("OPENAI_API_KEY");
  });

  it("runDoctor covers tty error formatting for missing fields", () => {
    const config = {
      ...defaultConfig,
      provider: {
        ...defaultConfig.provider,
        provider: "openai-compatible" as const,
        baseUrl: "",
        model: "",
        apiKey: ""
      }
    };

    const { stderr } = captureOutput(() => {
      withPatchedStream(process.stderr, { isTTY: true }, () => {
        const code = runDoctor(config, null);
        expect(code).toBe(1);
      });
    });

    expect(stderr).toContain("Missing provider.baseUrl");
    expect(stderr).toContain("Missing provider.model");
    expect(stderr).toContain("Missing provider.apiKey");
  });

  it("listPresets and showPreset expose stable public output", () => {
    const config = defaultConfig;
    const { stdout: listOutput } = captureOutput(() => {
      listPresets(config);
    });
    const { stdout: showOutput } = captureOutput(() => {
      showPreset(config, "infra-risk");
    });
    const { stdout: internalOutput } = captureOutput(() => {
      showPreset(config, "infra-risk", true);
    });

    expect(listOutput).toContain("infra-risk");
    expect(JSON.parse(showOutput)).toEqual({
      name: "infra-risk",
      question: config.presets["infra-risk"]?.question,
      format: config.presets["infra-risk"]?.format
    });
    expect(JSON.parse(internalOutput).policy).toBe("infra-risk");
  });

  it("showPreset throws for unknown names", () => {
    expect(() => showPreset(defaultConfig, "missing")).toThrow("Unknown preset: missing");
  });
});
