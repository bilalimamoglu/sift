import { describe, expect, it } from "vitest";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";
import { runCliAsync } from "./helpers/cli.js";

describe("exec mode", () => {
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

  it("does not use the legacy SIFT_API_KEY env var", async () => {
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
          SIFT_API_KEY: "legacy-key",
          SIFT_MODEL: "test-model"
        }
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Sift fallback triggered (Provider returned HTTP 401).");
    } finally {
      await server.close();
    }
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
