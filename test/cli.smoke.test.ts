import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";
import { runCli, runCliAsync } from "./helpers/cli.js";

describe("CLI smoke", () => {
  it("prints help", () => {
    const result = runCli({
      args: ["--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sift [question]");
    expect(result.stdout).toContain("SIFT_PROVIDER_API_KEY");
  });

  it("prints exec help with passthrough usage", () => {
    const result = runCli({
      args: ["exec", "--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sift exec [question] [options] -- <program> [args...]");
    expect(result.stdout).toContain("exec --preset test-status -- pytest");
  });

  it("supports config init, show, and validate", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-config-"));
    const configPath = path.join(dir, "sift.config.yaml");

    const init = runCli({
      args: ["config", "init", "--path", configPath]
    });
    const show = runCli({
      args: ["config", "show", "--config", configPath]
    });
    const validate = runCli({
      args: ["config", "validate", "--config", configPath]
    });

    expect(init.status).toBe(0);
    expect(init.stdout).toContain(configPath);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).provider.provider).toBe("openai-compatible");
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain("Resolved config is valid");
  });

  it("masks secrets in config show by default and reveals them with --show-secrets", async () => {
    const masked = runCli({
      args: ["config", "show"],
      env: {
        SIFT_PROVIDER_API_KEY: "env-secret-key"
      }
    });
    const revealed = runCli({
      args: ["config", "show", "--show-secrets"],
      env: {
        SIFT_PROVIDER_API_KEY: "env-secret-key"
      }
    });

    expect(masked.status).toBe(0);
    expect(JSON.parse(masked.stdout).provider.apiKey).toBe("***");
    expect(revealed.status).toBe(0);
    expect(JSON.parse(revealed.stdout).provider.apiKey).toBe("env-secret-key");
  });

  it("fails when an explicit config path does not exist", () => {
    const show = runCli({
      args: ["config", "show", "--config", "/tmp/definitely-missing-sift-config.yaml"]
    });
    const validate = runCli({
      args: ["config", "validate", "--config", "/tmp/definitely-missing-sift-config.yaml"]
    });

    expect(show.status).toBe(1);
    expect(show.stderr).toContain("Config file not found");
    expect(validate.status).toBe(1);
    expect(validate.stderr).toContain("Config file not found");
  });

  it("lists and shows presets", () => {
    const list = runCli({
      args: ["presets", "list"]
    });
    const show = runCli({
      args: ["presets", "show", "test-status"]
    });
    const internal = runCli({
      args: ["presets", "show", "test-status", "--internal"]
    });

    expect(list.status).toBe(0);
    expect(list.stdout).toContain("test-status");
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout)).toEqual({
      name: "test-status",
      question: "Did the tests pass? If not, list only the failing tests or suites.",
      format: "bullets"
    });
    expect(internal.status).toBe(0);
    expect(JSON.parse(internal.stdout).policy).toBe("test-status");
  });

  it("runs freeform and preset modes", async () => {
    const server = await createFakeOpenAIServer((_body, index) => ({
      body: {
        choices: [
          {
            message: {
              content:
                index === 0
                  ? "Short answer."
                  : JSON.stringify({
                      status: "ok",
                      vulnerabilities: [],
                      summary: "No high or critical vulnerabilities found in the provided input."
                    })
            }
          }
        ]
      }
    }));

    try {
      const freeform = await runCliAsync({
        args: [
          "what changed?",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model"
        ],
        input: "diff --git a/file b/file\n+change\n"
      });
      const preset = await runCliAsync({
        args: [
          "preset",
          "audit-critical",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model"
        ],
        input: "lodash critical vulnerability"
      });

      expect(freeform.status).toBe(0);
      expect(freeform.stdout).toContain("Short answer.");
      expect(preset.status).toBe(0);
      expect(JSON.parse(preset.stdout)).toEqual({
        status: "ok",
        vulnerabilities: [],
        summary: "No high or critical vulnerabilities found in the provided input."
      });
    } finally {
      await server.close();
    }
  });

  it("reports api key presence from environment in doctor output", async () => {
    const result = runCli({
      args: ["doctor"],
      env: {
        SIFT_BASE_URL: "https://example.test/v1",
        SIFT_PROVIDER_API_KEY: "env-key",
        SIFT_MODEL: "env-model"
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mode: local config completeness check");
    expect(result.stdout).toContain("apiKey: set");
    expect(result.stdout).toContain("model: env-model");
    expect(result.stdout).toContain("baseUrl: https://example.test/v1");
  });

  it("accepts OPENAI_API_KEY for the default OpenAI-compatible endpoint", () => {
    const result = runCli({
      args: ["doctor"],
      env: {
        OPENAI_API_KEY: "openai-key",
        SIFT_MODEL: "env-model"
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("apiKey: set");
    expect(result.stdout).toContain("baseUrl: https://api.openai.com/v1");
  });

  it("fails doctor when api key is missing for openai-compatible", () => {
    const result = runCli({
      args: ["doctor"],
      env: {
        SIFT_BASE_URL: "https://example.test/v1",
        SIFT_MODEL: "env-model"
      }
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("apiKey: not set");
    expect(result.stderr).toContain("Missing provider.apiKey");
    expect(result.stderr).toContain("SIFT_PROVIDER_API_KEY");
  });
});
