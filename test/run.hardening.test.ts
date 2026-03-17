import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { runSift } from "../src/core/run.js";
import type { SiftConfig } from "../src/types.js";
import { createFakeOpenAIServer, type FakeOpenAIServer } from "./helpers/fake-openai.js";

let server: FakeOpenAIServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function makeConfig(baseUrl: string): SiftConfig {
  return {
    ...defaultConfig,
    provider: {
      ...defaultConfig.provider,
      provider: "openai-compatible" as const,
      baseUrl,
      model: "test-model",
      apiKey: "test-key"
    }
  };
}

function withPatchedStderrTTY(value: boolean, fn: () => Promise<void>): Promise<void> {
  const original = process.stderr.isTTY;
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value
  });

  return fn().finally(() => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: original
    });
  });
}

describe("runSift hardening", () => {
  it("returns a strict error object for provider failures in built-in JSON presets", async () => {
    const auditCriticalPreset = defaultConfig.presets["audit-critical"]!;

    server = await createFakeOpenAIServer(() => ({
      status: 429,
      body: {
        error: "rate limit"
      }
    }));

    const output = await runSift({
      question: auditCriticalPreset.question,
      format: "json",
      policyName: "audit-critical",
      outputContract: auditCriticalPreset.outputContract,
      stdin: "critical vulnerability detected in dependency tree",
      config: makeConfig(server.baseUrl)
    });

    expect(JSON.parse(output)).toEqual({
      status: "error",
      reason: "Provider returned HTTP 429",
      retriable: true,
      provider_failed: true,
      raw_needed: true,
      why_raw_needed:
        "Provider follow-up failed, so the reduced answer may still need exact raw evidence."
    });
  });

  it("returns a strict error object for verdict provider failures", async () => {
    server = await createFakeOpenAIServer(() => ({
      status: 429,
      body: {
        error: "rate limit"
      }
    }));

    const output = await runSift({
      question: "is this safe?",
      format: "verdict",
      stdin: "Plan: 2 to destroy",
      config: makeConfig(server.baseUrl)
    });

    expect(JSON.parse(output)).toEqual({
      status: "error",
      reason: "Sift fallback: Provider returned HTTP 429",
      retriable: true,
      verdict: "unclear",
      evidence: [],
      provider_failed: true,
      raw_needed: true,
      why_raw_needed:
        "Provider follow-up failed, so the reduced answer may still need exact raw evidence."
    });
  });

  it("rejects markdown-wrapped JSON through the quality gate", async () => {
    const auditCriticalPreset = defaultConfig.presets["audit-critical"]!;

    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                '```json\n{"status":"ok","vulnerabilities":[],"summary":"No high or critical vulnerabilities found in the provided input."}\n```'
            }
          }
        ]
      }
    }));

    const output = await runSift({
      question: auditCriticalPreset.question,
      format: "json",
      policyName: "audit-critical",
      outputContract: auditCriticalPreset.outputContract,
      stdin: "critical vulnerability detected in dependency tree",
      config: makeConfig(server.baseUrl)
    });

    expect(JSON.parse(output)).toEqual({
      status: "error",
      reason: "Model output rejected by quality gate",
      retriable: false,
      provider_failed: true,
      raw_needed: true,
      why_raw_needed:
        "Provider follow-up failed, so the reduced answer may still need exact raw evidence."
    });
  });

  it("rejects meta text replies and falls back in text mode", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                "Please provide more context from the provided command output before I can answer."
            }
          }
        ]
      }
    }));

    const output = await runSift({
      question: "did tests pass?",
      format: "brief",
      stdin: "Ran 12 tests\n12 passed\n",
      config: makeConfig(server.baseUrl)
    });

    expect(output).toContain("Model output rejected by quality gate");
    expect(output).toContain("Ran 12 tests");
  });

  it("uses a simple heuristic for sparse audit-critical signals", async () => {
    const output = await runSift({
      question: defaultConfig.presets["audit-critical"]!.question,
      format: "json",
      policyName: "audit-critical",
      outputContract: defaultConfig.presets["audit-critical"]!.outputContract,
      stdin: "lodash: critical vulnerability\naxios: high severity advisory\n",
      config: makeConfig("https://api.openai.com/v1")
    });

    expect(JSON.parse(output)).toEqual({
      status: "ok",
      vulnerabilities: [
        {
          package: "lodash",
          severity: "critical",
          remediation: "Upgrade lodash to a patched version."
        },
        {
          package: "axios",
          severity: "high",
          remediation: "Upgrade axios to a patched version."
        }
      ],
      summary: "2 high or critical vulnerabilities found in the provided input."
    });
  });

  it("uses a simple heuristic for destructive infra summaries", async () => {
    const output = await runSift({
      question: defaultConfig.presets["infra-risk"]!.question,
      format: "verdict",
      policyName: "infra-risk",
      stdin: "Plan: 2 to add, 1 to destroy\n",
      config: makeConfig("https://api.openai.com/v1")
    });

    expect(JSON.parse(output)).toEqual({
      verdict: "fail",
      reason: "Destructive or clearly risky infrastructure change signals are present.",
      evidence: ["Plan: 2 to add, 1 to destroy"]
    });
  });

  it("treats zero destructive summaries as pass", async () => {
    const output = await runSift({
      question: defaultConfig.presets["infra-risk"]!.question,
      format: "verdict",
      policyName: "infra-risk",
      stdin: "Plan: 0 to destroy\nNo changes. Infrastructure is up-to-date.\n",
      config: makeConfig("https://api.openai.com/v1")
    });

    expect(JSON.parse(output)).toEqual({
      verdict: "pass",
      reason: "The provided input explicitly indicates zero destructive changes.",
      evidence: ["Plan: 0 to destroy"]
    });
  });

  it("retries once for retriable provider failures before succeeding", async () => {
    server = await createFakeOpenAIServer((_body, index) => {
      if (index === 0) {
        return {
          status: 429,
          body: {
            error: "rate limit"
          }
        };
      }

      return {
        body: {
          choices: [{ message: { content: "All tests passed." } }]
        }
      };
    });

    const output = await runSift({
      question: "did tests pass?",
      format: "brief",
      stdin: "Ran 12 tests\n12 passed\n",
      config: makeConfig(server.baseUrl)
    });

    expect(output).toBe("All tests passed.");
    expect(server.requests).toHaveLength(2);
  });

  it("shows a tiny pending notice on tty stderr while waiting for the provider", async () => {
    server = await createFakeOpenAIServer(() => ({
      delayMs: 250,
      body: {
        choices: [{ message: { content: "All tests passed." } }]
      }
    }));

    let stderr = "";
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr += chunk.toString();
        return true;
      });

    try {
      await withPatchedStderrTTY(true, async () => {
        const output = await runSift({
          question: "did tests pass?",
          format: "brief",
          stdin: "Ran 12 tests\n12 passed\n",
          config: makeConfig(server!.baseUrl)
        });

        expect(output).toBe("All tests passed.");
      });
    } finally {
      stderrWrite.mockRestore();
    }

    expect(stderr).toContain("sift waiting for provider...");
  });

  it("returns a dry-run payload instead of calling the provider", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "should not be used" } }]
      }
    }));

    const output = await runSift({
      question: "did tests pass?",
      format: "brief",
      stdin: "Ran 12 tests\n12 passed\n",
      config: makeConfig(server.baseUrl),
      dryRun: true
    });

    expect(JSON.parse(output)).toMatchObject({
      status: "dry-run",
      strategy: "provider",
      provider: {
        name: "openai-compatible",
        model: "test-model"
      },
      question: "did tests pass?",
      format: "brief"
    });
    expect(server.requests).toHaveLength(0);
  });

  it("short-circuits typecheck-summary through the heuristic path", async () => {
    const preset = defaultConfig.presets["typecheck-summary"]!;

    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                "- Typecheck failed.\n- TS2322 appears repeatedly around UserCard props.\n- Start with src/components/UserCard.tsx and src/types/user.ts."
            }
          }
        ]
      }
    }));

    const output = await runSift({
      question: preset.question,
      format: "bullets",
      policyName: "typecheck-summary",
      stdin:
        "src/components/UserCard.tsx:12:3 - error TS2322: Type 'string' is not assignable to type 'number'.\n" +
        "src/components/UserCard.tsx:18:7 - error TS2322: Type 'string' is not assignable to type 'number'.\n" +
        "src/types/user.ts:4:5 - error TS2741: Property 'id' is missing.\n",
      config: makeConfig(server.baseUrl)
    });

    expect(output).toContain("- Typecheck failed: 3 errors in 2 files.");
    expect(output).toContain("TS2322");
    expect(output.split("\n").length).toBeLessThanOrEqual(4);
    expect(server.requests).toHaveLength(0);
  });

  it("falls back to the provider for unsupported typecheck-summary input", async () => {
    const preset = defaultConfig.presets["typecheck-summary"]!;

    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                "- Typecheck failed.\n- The wrapper output does not expose concrete TypeScript diagnostics.\n- Re-run with raw tsc output."
            }
          }
        ]
      }
    }));

    const output = await runSift({
      question: preset.question,
      format: "bullets",
      policyName: "typecheck-summary",
      stdin: "TypeScript build failed in packages/ui. See the CI artifact for compiler details.\n",
      config: makeConfig(server.baseUrl)
    });

    expect(output).toContain("wrapper output does not expose concrete TypeScript diagnostics");
    expect(server.requests).toHaveLength(1);
  });

  it("short-circuits lint-failures through the heuristic path", async () => {
    const preset = defaultConfig.presets["lint-failures"]!;

    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                "- Lint failed.\n- @typescript-eslint/no-explicit-any is the main repeated rule.\n- Focus on src/app.ts and src/routes/api.ts first."
            }
          }
        ]
      }
    }));

    const output = await runSift({
      question: preset.question,
      format: "bullets",
      policyName: "lint-failures",
      stdin:
        "src/app.ts\n  1:12  error  Unexpected any  @typescript-eslint/no-explicit-any\n" +
        "src/routes/api.ts\n  4:10  error  Unexpected any  @typescript-eslint/no-explicit-any\n" +
        "src/routes/api.ts\n  7:3  warning  Unexpected console statement  no-console\n",
      config: makeConfig(server.baseUrl)
    });

    expect(output).toContain("- Lint failed: 3 problems (2 errors, 1 warning).");
    expect(output).toContain("@typescript-eslint/no-explicit-any");
    expect(output.split("\n").length).toBeLessThanOrEqual(4);
    expect(server.requests).toHaveLength(0);
  });

  it("falls back to the provider for unsupported lint-failures input", async () => {
    const preset = defaultConfig.presets["lint-failures"]!;

    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                "- Lint failed.\n- The captured formatter output is JSON, so the heuristic deferred to the provider.\n- Inspect the JSON payload for file-level detail."
            }
          }
        ]
      }
    }));

    const output = await runSift({
      question: preset.question,
      format: "bullets",
      policyName: "lint-failures",
      stdin:
        '[{"filePath":"src/app.ts","messages":[{"ruleId":"no-console","severity":1,"message":"Unexpected console statement."}]}]',
      config: makeConfig(server.baseUrl)
    });

    expect(output).toContain("formatter output is JSON");
    expect(server.requests).toHaveLength(1);
  });
});
