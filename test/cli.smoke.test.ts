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
    expect(validate.stdout).toContain("Config is valid");
  });

  it("lists and shows presets", () => {
    const list = runCli({
      args: ["presets", "list"]
    });
    const show = runCli({
      args: ["presets", "show", "test-status"]
    });

    expect(list.status).toBe(0);
    expect(list.stdout).toContain("test-status");
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).question).toContain("tests");
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
});
