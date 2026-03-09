import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolve.js";

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

  it("uses OPENAI_API_KEY for the default OpenAI-compatible base URL", () => {
    const config = resolveConfig({
      env: {
        OPENAI_API_KEY: "openai-fallback-key"
      }
    });

    expect(config.provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.provider.apiKey).toBe("openai-fallback-key");
  });

  it("does not use OPENAI_API_KEY for unknown openai-compatible endpoints", () => {
    const config = resolveConfig({
      env: {
        SIFT_BASE_URL: "https://proxy.example.test/v1",
        OPENAI_API_KEY: "openai-fallback-key"
      }
    });

    expect(config.provider.apiKey).toBe("");
  });

  it("reads SIFT_PROVIDER_API_KEY for the openai-compatible provider", () => {
    const config = resolveConfig({
      env: {
        SIFT_PROVIDER_API_KEY: "provider-key"
      }
    });

    expect(config.provider.apiKey).toBe("provider-key");
  });

  it("does not read the legacy SIFT_API_KEY env var", () => {
    const config = resolveConfig({
      env: {
        SIFT_API_KEY: "legacy-key"
      }
    });

    expect(config.provider.apiKey).toBe("");
  });
});
