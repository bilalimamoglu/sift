import { describe, expect, it } from "vitest";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";
import { runCliAsync } from "./helpers/cli.js";

describe("exec mode", () => {
  it("runs against the native openai provider", async () => {
    const server = await createFakeOpenAIServer((_body, _index, request) => ({
      body:
        request.path.includes("/responses")
          ? {
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: "All tests passed."
                    }
                  ]
                }
              ]
            }
          : {}
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "did the tests pass?",
          "--provider",
          "openai",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model",
          "--",
          "node",
          "-e",
          "console.log('Ran 12 tests\\n12 passed')"
        ]
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("All tests passed.");
    } finally {
      await server.close();
    }
  });

  it("runs a freeform command and reduces its output", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "All tests passed." } }]
      }
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "did the tests pass?",
          "--provider",
          "openai-compatible",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model",
          "--",
          "node",
          "-e",
          "console.log('Ran 12 tests\\n12 passed')"
        ]
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("All tests passed.");
    } finally {
      await server.close();
    }
  });

  it("accepts provider credentials from environment variables", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "Environment-based auth worked." } }]
      }
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "did the tests pass?",
          "--",
          "node",
          "-e",
          "console.log('Ran 12 tests\\n12 passed')"
        ],
        env: {
          SIFT_PROVIDER: "openai-compatible",
          SIFT_BASE_URL: server.baseUrl,
          SIFT_PROVIDER_API_KEY: "test-key",
          SIFT_MODEL: "test-model"
        }
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("Environment-based auth worked.");
    } finally {
      await server.close();
    }
  });

  it("does not use OPENAI_API_KEY for unknown openai-compatible endpoints", async () => {
    const server = await createFakeOpenAIServer(() => ({
      status: 401,
      body: {
        error: "missing auth"
      }
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "did the tests pass?",
          "--",
          "node",
          "-e",
          "console.log('Ran 12 tests\\n12 passed')"
        ],
        env: {
          SIFT_BASE_URL: server.baseUrl,
          OPENAI_API_KEY: "test-key",
          SIFT_MODEL: "test-model"
        }
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Sift fallback triggered (Provider returned HTTP 401).");
    } finally {
      await server.close();
    }
  });

  it("supports dry-run mode without calling the provider", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "did the tests pass?",
        "--dry-run",
        "--",
        "node",
        "-e",
        "console.log('Ran 12 tests\\n12 passed')"
      ]
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "dry-run",
      strategy: "provider",
      question: "did the tests pass?",
      format: "brief"
    });
  });

  it("preserves a failing child exit code for preset exec mode", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: "- Tests did not pass.\n- Failing test: test_auth"
            }
          }
        ]
      }
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "--preset",
          "test-status",
          "--provider",
          "openai-compatible",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model",
          "--",
          "node",
          "-e",
          "console.error('FAIL test_auth'); process.exit(1)"
        ]
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Tests did not pass");
    } finally {
      await server.close();
    }
  });

  it("supports shell mode for preset exec flows", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "infra-risk",
        "--shell",
        "printf 'Plan: 2 to add, 1 to destroy\\n'"
      ]
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      verdict: "fail",
      reason: "Destructive or clearly risky infrastructure change signals are present.",
      evidence: ["Plan: 2 to add, 1 to destroy"]
    });
  });

  it("returns exit 1 for infra-risk fail verdicts when --fail-on is enabled", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "infra-risk",
        "--fail-on",
        "--shell",
        "printf 'Plan: 2 to add, 1 to destroy\\n'"
      ]
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).verdict).toBe("fail");
  });

  it("returns exit 0 for infra-risk pass verdicts when --fail-on is enabled", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "infra-risk",
        "--fail-on",
        "--shell",
        "printf 'Plan: 0 to destroy\\nNo changes. Infrastructure is up-to-date.\\n'"
      ]
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).verdict).toBe("pass");
  });

  it("returns exit 1 for audit-critical findings when --fail-on is enabled", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "audit-critical",
        "--fail-on",
        "--shell",
        "printf 'lodash: critical vulnerability\\n'"
      ]
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).vulnerabilities).toHaveLength(1);
  });

  it("returns exit 0 for empty audit-critical findings when --fail-on is enabled", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({
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
      const result = await runCliAsync({
        args: [
          "exec",
          "--preset",
          "audit-critical",
          "--fail-on",
          "--provider",
          "openai-compatible",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model",
          "--",
          "node",
          "-e",
          "console.log('No vulnerabilities found')"
        ]
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).vulnerabilities).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("skips gate evaluation in dry-run mode", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "infra-risk",
        "--fail-on",
        "--dry-run",
        "--shell",
        "printf 'Plan: 2 to add, 1 to destroy\\n'"
      ]
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "dry-run",
      format: "verdict",
      policy: "infra-risk"
    });
  });

  it("keeps the original failing child exit code when --fail-on is enabled", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "infra-risk",
        "--fail-on",
        "--shell",
        "printf 'Plan: 2 to add, 1 to destroy\\n'; exit 2"
      ]
    });

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).verdict).toBe("fail");
  });

  it("fails clearly when --fail-on is used with unsupported presets", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--fail-on",
        "--",
        "node",
        "-e",
        "console.log('12 passed')"
      ]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("supported only for built-in presets: infra-risk, audit-critical");
  });

  it("fails clearly when --fail-on is used with freeform questions", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "did the tests pass?",
        "--fail-on",
        "--",
        "node",
        "-e",
        "console.log('12 passed')"
      ]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("supported only for built-in presets: infra-risk, audit-critical");
  });

  it("fails clearly when --fail-on is used with a non-default preset format", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "infra-risk",
        "--format",
        "json",
        "--fail-on",
        "--shell",
        "printf 'Plan: 2 to add, 1 to destroy\\n'"
      ]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("default verdict format for preset infra-risk");
  });

  it("supports typecheck-summary preset exec flows", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                "- Typecheck failed.\n- TS2322 repeats in src/app.ts.\n- Fix src/app.ts before chasing downstream errors."
            }
          }
        ]
      }
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "--preset",
          "typecheck-summary",
          "--provider",
          "openai-compatible",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model",
          "--",
          "node",
          "-e",
          "console.error('src/app.ts:1:1 - error TS2322: Type string is not assignable to type number'); process.exit(1)"
        ]
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Typecheck failed.");
    } finally {
      await server.close();
    }
  });

  it("returns a short success answer for silent typecheck success", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "typecheck-summary",
        "--",
        "node",
        "-e",
        "process.exit(0)"
      ]
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("No type errors.");
    expect(result.stderr).toBe("");
  });

  it("supports lint-failures preset exec flows", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content:
                "- Lint failed.\n- no-explicit-any is the top repeated rule.\n- Start with src/app.ts."
            }
          }
        ]
      }
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "--preset",
          "lint-failures",
          "--provider",
          "openai-compatible",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model",
          "--",
          "node",
          "-e",
          "console.error('src/app.ts\\n  1:1  error  Unexpected any  @typescript-eslint/no-explicit-any'); process.exit(1)"
        ]
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Lint failed.");
    } finally {
      await server.close();
    }
  });

  it("keeps the child exit code when reduction falls back", async () => {
    const server = await createFakeOpenAIServer(() => ({
      status: 429,
      body: {
        error: "rate limit"
      }
    }));

    try {
      const result = await runCliAsync({
        args: [
          "exec",
          "did the tests pass?",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model",
          "--",
          "node",
          "-e",
          "console.log('12 passed')"
        ]
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Sift fallback triggered (Provider returned HTTP 429).");
    } finally {
      await server.close();
    }
  });

  it("bypasses reduction for interactive prompt-like output", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "should not reduce",
        "--",
        "node",
        "-e",
        "process.stderr.write('Password: '); process.exit(0)"
      ]
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Password:");
  });

  it("rejects the old exec preset syntax with a clear error", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "preset",
        "test-status",
        "--",
        "node",
        "-e",
        "console.log('12 passed')"
      ]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use 'sift exec --preset <name> -- <program> ...' instead.");
  });

});
