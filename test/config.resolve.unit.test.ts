import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { mergeDefined, resolveConfig } from "../src/config/resolve.js";

async function createEmptyConfigFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-empty-config-"));
  const configPath = path.join(dir, "sift.config.yaml");
  await fs.writeFile(configPath, "presets: {}\n", "utf8");
  return configPath;
}

describe("resolveConfig", () => {
  it("applies config file, env, then CLI precedence", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-config-"));
    const configPath = path.join(dir, "sift.config.yaml");

    await fs.writeFile(
      configPath,
      [
        "provider:",
        "  provider: openai-compatible",
        "  model: file-model",
        "  baseUrl: https://file.example/v1",
        "  timeoutMs: 11111",
        "  temperature: 0.2",
        "  maxOutputTokens: 111",
        "input:",
        "  stripAnsi: true",
        "  redact: false",
        "  redactStrict: false",
        "  maxInputChars: 9999",
        "  headChars: 100",
        "  tailChars: 100",
        "runtime:",
        "  rawFallback: false",
        "  verbose: false",
        "presets: {}"
      ].join("\n"),
      "utf8"
    );

    const config = resolveConfig({
      configPath,
      env: {
        SIFT_MODEL: "env-model",
        SIFT_BASE_URL: "https://env.example/v1",
        SIFT_TIMEOUT_MS: "22222",
        SIFT_MAX_CAPTURE_CHARS: "4444",
        SIFT_MAX_INPUT_CHARS: "5555"
      },
      cliOverrides: {
        provider: {
          model: "cli-model"
        },
        input: {
          maxInputChars: 3333
        }
      }
    });

    expect(config.provider.model).toBe("cli-model");
    expect(config.provider.baseUrl).toBe("https://env.example/v1");
    expect(config.provider.timeoutMs).toBe(22222);
    expect(config.input.maxCaptureChars).toBe(4444);
    expect(config.input.maxInputChars).toBe(3333);
    expect(config.runtime.rawFallback).toBe(false);
  });

  it("uses OPENAI_API_KEY for the default OpenAI-compatible base URL", async () => {
    const configPath = await createEmptyConfigFile();
    const config = resolveConfig({
      configPath,
      env: {
        OPENAI_API_KEY: "openai-fallback-key"
      }
    });

    expect(config.provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.provider.apiKey).toBe("openai-fallback-key");
  });

  it("does not use OPENAI_API_KEY for unknown openai-compatible endpoints", async () => {
    const configPath = await createEmptyConfigFile();
    const config = resolveConfig({
      configPath,
      env: {
        SIFT_PROVIDER: "openai-compatible",
        SIFT_BASE_URL: "https://proxy.example.test/v1",
        OPENAI_API_KEY: "openai-fallback-key"
      }
    });

    expect(config.provider.apiKey).toBe("");
  });

  it("reads SIFT_PROVIDER_API_KEY for the openai-compatible provider", async () => {
    const configPath = await createEmptyConfigFile();
    const config = resolveConfig({
      configPath,
      env: {
        SIFT_PROVIDER: "openai-compatible",
        SIFT_PROVIDER_API_KEY: "provider-key"
      }
    });

    expect(config.provider.apiKey).toBe("provider-key");
  });

  it("uses OPENAI_API_KEY for the openai provider", async () => {
    const configPath = await createEmptyConfigFile();
    const config = resolveConfig({
      configPath,
      env: {
        SIFT_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key"
      }
    });

    expect(config.provider.provider).toBe("openai");
    expect(config.provider.apiKey).toBe("openai-key");
  });

  it("applies OpenRouter defaults when provider is openrouter", async () => {
    const configPath = await createEmptyConfigFile();
    const config = resolveConfig({
      configPath,
      env: {
        SIFT_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "openrouter-key"
      }
    });

    expect(config.provider.provider).toBe("openrouter");
    expect(config.provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.provider.model).toBe("openrouter/free");
    expect(config.provider.apiKey).toBe("openrouter-key");
  });

  it("preserves explicit OpenRouter model and base URL overrides", async () => {
    const configPath = await createEmptyConfigFile();
    const config = resolveConfig({
      configPath,
      env: {
        SIFT_PROVIDER: "openrouter",
        SIFT_MODEL: "anthropic/claude-3.5-haiku",
        SIFT_BASE_URL: "https://openrouter.ai/api/v1/custom",
        OPENROUTER_API_KEY: "openrouter-key"
      }
    });

    expect(config.provider.baseUrl).toBe("https://openrouter.ai/api/v1/custom");
    expect(config.provider.model).toBe("anthropic/claude-3.5-haiku");
  });

  it("ignores non-object file config and preserves CLI apiKey precedence", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-config-non-object-"));
    const configPath = path.join(dir, "sift.config.yaml");
    await fs.writeFile(configPath, "[]\n", "utf8");

    const config = resolveConfig({
      configPath,
      env: {
        SIFT_PROVIDER_API_KEY: "env-key"
      },
      cliOverrides: {
        provider: {
          apiKey: "cli-key"
        }
      }
    });

    expect(config.provider.apiKey).toBe("cli-key");
    expect(config.provider.model).toBe("gpt-5-nano");
  });

  it("handles partial input env overrides independently", async () => {
    const configPath = await createEmptyConfigFile();
    const captureOnly = resolveConfig({
      configPath,
      env: {
        SIFT_MAX_CAPTURE_CHARS: "1234"
      }
    });
    const inputOnly = resolveConfig({
      configPath,
      env: {
        SIFT_MAX_INPUT_CHARS: "4321"
      }
    });

    expect(captureOnly.input.maxCaptureChars).toBe(1234);
    expect(captureOnly.input.maxInputChars).toBe(defaultConfig.input.maxInputChars);
    expect(inputOnly.input.maxInputChars).toBe(4321);
    expect(inputOnly.input.maxCaptureChars).toBe(defaultConfig.input.maxCaptureChars);
  });

  it("covers mergeDefined primitive bases and default env resolution", () => {
    expect(mergeDefined("base", { nested: true } as unknown)).toEqual({
      nested: true
    });

    const originalProvider = process.env.SIFT_PROVIDER;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    process.env.SIFT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "default-openai-key";

    try {
      expect(resolveConfig().provider.apiKey).toBe("default-openai-key");
    } finally {
      process.env.SIFT_PROVIDER = originalProvider;
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

});
