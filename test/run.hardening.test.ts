import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { runSift } from "../src/core/run.js";
import { createFakeOpenAIServer, type FakeOpenAIServer } from "./helpers/fake-openai.js";

let server: FakeOpenAIServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function makeConfig(baseUrl: string) {
  return {
    ...defaultConfig,
    provider: {
      ...defaultConfig.provider,
      baseUrl,
      model: "test-model",
      apiKey: "test-key"
    }
  };
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
      retriable: true
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
      evidence: []
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
      retriable: false
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
});
