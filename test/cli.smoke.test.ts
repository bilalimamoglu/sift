import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { runSourceCli, runSourceCliAsync } from "./helpers/cli.js";

describe("CLI smoke", () => {
  it("prints help", () => {
    const result = runSourceCli({
      args: ["--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("  \\\\  //");
    expect(result.stdout).toContain("sift [question]");
    expect(result.stdout).toContain("Trim the noise. Keep the signal.");
    expect(result.stdout).toContain("Provider: openai | openai-compatible | openrouter");
    expect(result.stdout).toContain("SIFT_PROVIDER_API_KEY");
    expect(result.stdout).toContain("OPENAI_API_KEY");
    expect(result.stdout).toContain("OPENROUTER_API_KEY");
    expect(result.stdout).toContain("--show-raw");
    expect(result.stdout).toContain("--detail <mode>");
    expect(result.stdout).toContain("escalate");
    expect(result.stdout).toContain("rerun");
    expect(result.stdout).toContain("agent <action> [name]");
    expect(result.stdout).toContain("config <action> [provider]");
  });

  it("prints config help with the provider switch example", () => {
    const result = runSourceCli({
      args: ["config", "--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("config <setup|init|show|validate|use> [provider] [options]");
    expect(result.stdout).toContain("config use openrouter");
  });

  it("prints exec help with passthrough usage", () => {
    const result = runSourceCli({
      args: ["exec", "--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("  \\\\  //");
    expect(result.stdout).toContain("sift exec [question] [options] -- <program> [args...]");
    expect(result.stdout).toContain("exec --preset test-status -- npm test");
    expect(result.stdout).toContain("--diff");
    expect(result.stdout).toContain("--include-test-ids");
  });

  it("prints escalate help", () => {
    const result = runSourceCli({
      args: ["escalate", "--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sift escalate [options]");
    expect(result.stdout).toContain("Escalation detail level: focused | verbose");
    expect(result.stdout).toContain("--show-raw");
  });

  it("prints rerun help", () => {
    const result = runSourceCli({
      args: ["rerun", "--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sift rerun [options]");
    expect(result.stdout).toContain("rerun --remaining --detail focused");
    expect(result.stdout).toContain("--remaining");
    expect(result.stdout).toContain("--include-test-ids");
    expect(result.stdout).toContain("--show-raw");
  });

  it("prints watch help", () => {
    const result = runSourceCli({
      args: ["watch", "--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sift watch [question] [options]");
    expect(result.stdout).toContain("watch --preset test-status < pytest-watch.txt");
    expect(result.stdout).toContain("--goal <goal>");
    expect(result.stdout).toContain("--include-test-ids");
  });

  it("prints agent help with scope and dry-run examples", () => {
    const result = runSourceCli({
      args: ["agent", "--help"]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("agent <show|install|remove|status> [name] [options]");
    expect(result.stdout).toContain("agent install codex --dry-run");
    expect(result.stdout).toContain("agent show codex --raw");
    expect(result.stdout).toContain("agent install codex --dry-run --raw");
    expect(result.stdout).toContain("--scope <scope>");
    expect(result.stdout).toContain("--raw");
  });

  it("supports config init, show, and validate", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-config-"));
    const configPath = path.join(dir, "sift.config.yaml");

    const init = runSourceCli({
      args: ["config", "init", "--path", configPath]
    });
    const show = runSourceCli({
      args: ["config", "show", "--config", configPath]
    });
    const validate = runSourceCli({
      args: ["config", "validate", "--config", configPath]
    });

    expect(init.status).toBe(0);
    expect(init.stdout).toContain(configPath);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).provider.provider).toBe("openai");
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain("Resolved config is valid");
  });

  it("fails clearly for non-interactive config setup", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-setup-"));
    const configPath = path.join(dir, "sift.config.yaml");

    const result = runSourceCli({
      args: ["config", "setup", "--path", configPath]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sift config setup is interactive and requires a TTY");
    expect(result.stderr).toContain("sift config init --global");
  });

  it("supports machine-wide config init via --global", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-home-"));
    const expectedPath = path.join(home, ".config", "sift", "config.yaml");

    const init = runSourceCli({
      args: ["config", "init", "--global"],
      env: {
        HOME: home
      }
    });

    const validate = runSourceCli({
      args: ["config", "validate"],
      cwd: home,
      env: {
        HOME: home
      }
    });

    expect(init.status).toBe(0);
    expect(init.stdout.trim()).toBe(expectedPath);
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain(expectedPath);
  });

  it("masks secrets in config show by default and reveals them with --show-secrets", async () => {
    const masked = runSourceCli({
      args: ["config", "show"],
      env: {
        SIFT_PROVIDER_API_KEY: "env-secret-key"
      }
    });
    const revealed = runSourceCli({
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

  it("supports config use with environment-backed OpenRouter switching", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-use-home-"));
    const expectedPath = path.join(home, ".config", "sift", "config.yaml");

    const use = runSourceCli({
      args: ["config", "use", "openrouter"],
      cwd: home,
      env: {
        HOME: home,
        OPENROUTER_API_KEY: "env-openrouter-key"
      }
    });

    const written = YAML.parse(await fs.readFile(expectedPath, "utf8")) as {
      provider: { provider: string; model: string; baseUrl: string; apiKey: string };
      providerProfiles?: { openrouter?: { apiKey?: string } };
    };

    expect(use.status).toBe(0);
    expect(use.stdout).toContain("Switched active provider to openrouter");
    expect(use.stdout).toContain("No API key was written to config");
    expect(written.provider.provider).toBe("openrouter");
    expect(written.provider.model).toBe("openrouter/free");
    expect(written.provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(written.provider.apiKey).toBe("");
    expect(written.providerProfiles?.openrouter?.apiKey).toBeUndefined();
  });

  it("fails config use when no saved key or provider env key exists", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-use-fail-home-"));

    const result = runSourceCli({
      args: ["config", "use", "openrouter"],
      cwd: home,
      env: {
        HOME: home
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Run 'sift config setup' first.");
  });

  it("fails when an explicit config path does not exist", () => {
    const show = runSourceCli({
      args: ["config", "show", "--config", "/tmp/definitely-missing-sift-config.yaml"]
    });
    const validate = runSourceCli({
      args: ["config", "validate", "--config", "/tmp/definitely-missing-sift-config.yaml"]
    });

    expect(show.status).toBe(1);
    expect(show.stderr).toContain("Config file not found");
    expect(validate.status).toBe(1);
    expect(validate.stderr).toContain("Config file not found");
  });

  it("lists and shows presets", () => {
    const list = runSourceCli({
      args: ["presets", "list"]
    });
    const show = runSourceCli({
      args: ["presets", "show", "test-status"]
    });
    const internal = runSourceCli({
      args: ["presets", "show", "test-status", "--internal"]
    });
    const typecheck = runSourceCli({
      args: ["presets", "show", "typecheck-summary"]
    });
    const lint = runSourceCli({
      args: ["presets", "show", "lint-failures"]
    });

    expect(list.status).toBe(0);
    expect(list.stdout).toContain("test-status");
    expect(list.stdout).toContain("typecheck-summary");
    expect(list.stdout).toContain("lint-failures");
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout)).toEqual({
      name: "test-status",
      question: "Did the tests pass? If not, list only the failing tests or suites.",
      format: "bullets"
    });
    expect(internal.status).toBe(0);
    expect(JSON.parse(internal.stdout).policy).toBe("test-status");
    expect(typecheck.status).toBe(0);
    expect(JSON.parse(typecheck.stdout)).toEqual({
      name: "typecheck-summary",
      question:
        "Summarize the blocking typecheck failures. Group repeated errors by root cause and point to the first files or symbols to fix.",
      format: "bullets"
    });
    expect(lint.status).toBe(0);
    expect(JSON.parse(lint.stdout)).toEqual({
      name: "lint-failures",
      question:
        "Summarize the blocking lint failures. Group repeated rules, highlight the top offending files, and call out only failures that matter for fixing the run.",
      format: "bullets"
    });
  });

  it("supports --fail-on in preset pipe mode for infra-risk", async () => {
    const result = await runSourceCliAsync({
      args: ["preset", "infra-risk", "--fail-on"],
      input: "Plan: 2 to add, 1 to destroy\n"
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).verdict).toBe("fail");
  });

  it("supports --detail focused in preset pipe mode for test-status", async () => {
    const result = await runSourceCliAsync({
      args: ["preset", "test-status", "--detail", "focused"],
      input: [
        "4 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
        "E   ModuleNotFoundError: No module named 'fastapi'"
      ].join("\n")
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Import/dependency blocker: 4 errors are caused by missing dependencies during test collection."
    );
    expect(result.stdout).toContain("tests/unit/test_auth.py -> missing module: pydantic");
    expect(result.stdout).toContain("tests/unit/test_api.py -> missing module: fastapi");
  });

  it("supports --detail verbose in preset pipe mode for test-status", async () => {
    const result = await runSourceCliAsync({
      args: ["preset", "test-status", "--detail", "verbose"],
      input: [
        "2 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
        "E   ModuleNotFoundError: No module named 'fastapi'"
      ].join("\n")
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- tests/unit/test_auth.py -> missing module: pydantic");
    expect(result.stdout).toContain("- tests/unit/test_api.py -> missing module: fastapi");
    expect(result.stdout).not.toContain("import/dependency errors during collection");
  });

  it("rejects --fail-on for unsupported preset pipe mode", async () => {
    const result = await runSourceCliAsync({
      args: ["preset", "test-status", "--fail-on"],
      input: "Ran 12 tests\n12 passed\n"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("supported only for built-in presets: infra-risk, audit-critical");
  });

  it("rejects --detail for unsupported preset pipe mode", async () => {
    const result = await runSourceCliAsync({
      args: ["preset", "infra-risk", "--detail", "focused"],
      input: "Plan: 2 to add, 1 to destroy\n"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--detail is supported only with --preset test-status.");
  });

  it("rejects --fail-on for freeform pipe mode", async () => {
    const result = await runSourceCliAsync({
      args: ["did the tests pass?", "--fail-on"],
      input: "Ran 12 tests\n12 passed\n"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("supported only for built-in presets: infra-risk, audit-critical");
  });

  it("rejects --detail for freeform pipe mode", async () => {
    const result = await runSourceCliAsync({
      args: ["did the tests pass?", "--detail", "focused"],
      input: "Ran 12 tests\n12 passed\n"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--detail is supported only with --preset test-status.");
  });

  it("reports api key presence from environment in doctor output", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
    const result = runSourceCli({
      args: ["doctor"],
      cwd,
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

  it("isolates ambient provider env vars from CLI child processes", async () => {
    const previousProvider = process.env.SIFT_PROVIDER;
    const previousApiKey = process.env.OPENAI_API_KEY;

    process.env.SIFT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "ambient-key";

    try {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
      const result = runSourceCli({
        args: ["doctor"],
        cwd,
        env: {
          SIFT_BASE_URL: "https://example.test/v1",
          SIFT_MODEL: "env-model"
        }
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("configPath: (defaults only)");
      expect(result.stdout).toContain("provider: openai");
      expect(result.stdout).toContain("apiKey: not set");
    } finally {
      if (previousProvider === undefined) {
        delete process.env.SIFT_PROVIDER;
      } else {
        process.env.SIFT_PROVIDER = previousProvider;
      }

      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });

  it("isolates ambient HOME-based global config from CLI child processes", async () => {
    const previousHome = process.env.HOME;
    const ambientHome = await fs.mkdtemp(path.join(os.tmpdir(), "sift-ambient-home-"));
    const ambientConfigPath = path.join(
      ambientHome,
      ".config",
      "sift",
      "config.yaml"
    );
    await fs.mkdir(path.dirname(ambientConfigPath), { recursive: true });
    await fs.writeFile(
      ambientConfigPath,
      [
        "provider:",
        "  provider: openai",
        "  model: leaked-model",
        "  baseUrl: https://api.openai.com/v1",
        "  apiKey: leaked-key"
      ].join("\n"),
      "utf8"
    );

    process.env.HOME = ambientHome;

    try {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
      const result = runSourceCli({
        args: ["doctor"],
        cwd
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("configPath: (defaults only)");
      expect(result.stdout).toContain("provider: openai");
      expect(result.stdout).toContain("model: gpt-5-nano");
      expect(result.stdout).toContain("apiKey: not set");
      expect(result.stdout).not.toContain("leaked-model");
      expect(result.stdout).not.toContain("leaked-key");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });

  it("accepts OPENAI_API_KEY for the openai provider", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
    const result = runSourceCli({
      args: ["doctor"],
      cwd,
      env: {
        SIFT_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        SIFT_MODEL: "env-model"
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("provider: openai");
    expect(result.stdout).toContain("apiKey: set");
    expect(result.stdout).toContain("baseUrl: https://api.openai.com/v1");
  });

  it("still accepts OPENAI_API_KEY for the default OpenAI-compatible endpoint", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
    const result = runSourceCli({
      args: ["doctor"],
      cwd,
      env: {
        SIFT_PROVIDER: "openai-compatible",
        OPENAI_API_KEY: "openai-key",
        SIFT_MODEL: "env-model"
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("provider: openai-compatible");
    expect(result.stdout).toContain("apiKey: set");
  });

  it("accepts OPENROUTER_API_KEY for the openrouter provider defaults", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
    const result = runSourceCli({
      args: ["doctor"],
      cwd,
      env: {
        SIFT_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "openrouter-key"
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("provider: openrouter");
    expect(result.stdout).toContain("apiKey: set");
    expect(result.stdout).toContain("model: openrouter/free");
    expect(result.stdout).toContain("baseUrl: https://openrouter.ai/api/v1");
  });

  it("fails doctor when api key is missing for openai-compatible", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-home-"));
    const result = runSourceCli({
      args: ["doctor"],
      cwd,
      env: {
        HOME: home,
        SIFT_BASE_URL: "https://example.test/v1",
        SIFT_MODEL: "env-model"
      }
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("configPath: (defaults only)");
    expect(result.stdout).toContain("apiKey: not set");
    expect(result.stderr).toContain("Missing provider.apiKey");
    expect(result.stderr).toContain("SIFT_PROVIDER_API_KEY");
  });

  it("fails doctor when api key is missing for openrouter", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-doctor-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-cli-home-"));
    const result = runSourceCli({
      args: ["doctor"],
      cwd,
      env: {
        HOME: home,
        SIFT_PROVIDER: "openrouter"
      }
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("provider: openrouter");
    expect(result.stdout).toContain("apiKey: not set");
    expect(result.stderr).toContain("Missing provider.apiKey");
    expect(result.stderr).toContain("OPENROUTER_API_KEY");
  });
});
