import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";
import { runCliAsync } from "./helpers/cli.js";

async function readRealFixture(name: string): Promise<string> {
  return fs.readFile(
    path.resolve(import.meta.dirname, "fixtures", "bench", "test-status", "real", name),
    "utf8"
  );
}

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

  it("prints captured raw output to stderr when --show-raw is set", async () => {
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
          "--show-raw",
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
      expect(result.stderr).toContain("Ran 12 tests");
      expect(result.stderr).toContain("12 passed");
    } finally {
      await server.close();
    }
  });

  it("shows raw output on stderr and dry-run JSON on stdout", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "did the tests pass?",
        "--dry-run",
        "--show-raw",
        "--",
        "node",
        "-e",
        "console.log('Ran 12 tests\\n12 passed')"
      ]
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "dry-run",
      question: "did the tests pass?"
    });
    expect(result.stderr).toContain("Ran 12 tests");
    expect(result.stderr).toContain("12 passed");
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

  it("uses a local summary for obvious pytest success output", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--shell",
        "printf '================ 12 passed, 1 skipped in 0.42s ================\\n'"
      ]
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("- Tests passed.\n- 12 tests, 1 skip.");
    expect(result.stderr).toBe("");
  });

  it("uses a local summary for pytest collection errors", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--shell",
        "printf '================ 134 errors during collection ================\\n'; exit 2"
      ]
    });

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("- Tests did not complete.\n- 134 errors occurred during collection.");
    expect(result.stderr).toBe("");
  });

  it("groups repeated import-time root causes for collection failures", async () => {
    const script = [
      "const lines = [",
      "  '================ 114 errors during collection ================',",
      "  '_ ERROR collecting tests/unit/test_auth.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_auth.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'pydantic'\",",
      "  '_ ERROR collecting tests/unit/test_api.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_api.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'fastapi'\",",
      "  '_ ERROR collecting tests/unit/test_jobs.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_jobs.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'botocore'\"",
      "];",
      "console.error(lines.join('\\n'));",
      "process.exit(2);"
    ].join(" ");

    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--",
        "node",
        "-e",
        script
      ]
    });

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe(
      [
        "- Tests did not complete.",
        "- 114 errors occurred during collection.",
        "- Import/dependency blocker: 114 errors are caused by missing dependencies during test collection.",
        "- Missing modules include pydantic, fastapi, botocore.",
        "- Hint: Install the missing dependencies and rerun the affected tests.",
        "- Next: Fix bucket 1 first, then rerun the full suite at standard.",
        "- Stop signal: diagnosis complete; raw not needed."
      ].join("\n")
    );
    expect(result.stderr).toBe("");
  });

  it("supports focused test-status output for visible collection failures", async () => {
    const script = [
      "const lines = [",
      "  '================ 4 errors during collection ================',",
      "  '_ ERROR collecting tests/unit/test_auth.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_auth.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'pydantic'\",",
      "  '_ ERROR collecting tests/unit/test_api.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_api.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'fastapi'\"",
      "];",
      "console.error(lines.join('\\n'));",
      "process.exit(2);"
    ].join(" ");

    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--detail",
        "focused",
        "--",
        "node",
        "-e",
        script
      ]
    });

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe(
      [
        "- Tests did not complete.",
        "- 4 errors occurred during collection.",
        "- Import/dependency blocker: at least 2 visible errors are caused by missing dependencies during test collection.",
        "- Missing modules include pydantic, fastapi.",
        "  - tests/unit/test_auth.py -> missing module: pydantic",
        "  - tests/unit/test_api.py -> missing module: fastapi",
        "  - Hint: Install the missing dependencies and rerun the affected tests.",
        "- Next: Fix bucket 1 first, then rerun the full suite at standard.",
        "- Stop signal: diagnosis complete; raw not needed."
      ].join("\n")
    );
  });

  it("supports verbose test-status output for visible collection failures", async () => {
    const script = [
      "const lines = [",
      "  '================ 4 errors during collection ================',",
      "  '_ ERROR collecting tests/unit/test_auth.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_auth.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'pydantic'\",",
      "  '_ ERROR collecting tests/unit/test_api.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_api.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'fastapi'\"",
      "];",
      "console.error(lines.join('\\n'));",
      "process.exit(2);"
    ].join(" ");

    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--detail",
        "verbose",
        "--",
        "node",
        "-e",
        script
      ]
    });

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe(
      [
        "- Tests did not complete.",
        "- 4 errors occurred during collection.",
        "- Import/dependency blocker: at least 2 visible errors are caused by missing dependencies during test collection.",
        "- Missing modules include pydantic, fastapi.",
        "  - tests/unit/test_auth.py -> missing module: pydantic",
        "  - tests/unit/test_api.py -> missing module: fastapi",
        "  - Hint: Install the missing dependencies and rerun the affected tests.",
        "- Next: Fix bucket 1 first, then rerun the full suite at standard.",
        "- Stop signal: diagnosis complete; raw not needed."
      ].join("\n")
    );
  });

  it("reuses the cached test-status run during escalate without rerunning the child command", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-escalate-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-escalate-cwd-"));
    const counterPath = path.join(cwd, "counter.txt");
    const statePath = path.join(home, ".config", "sift", "state", "last-test-status.json");
    const script = [
      "const fs = require('node:fs');",
      "fs.appendFileSync(process.argv[1], 'x');",
      "console.error('FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token');",
      "process.exit(1);"
    ].join(" ");

    const execResult = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--",
        "node",
        "-e",
        script,
        counterPath
      ],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(execResult.status).toBe(1);
    expect(await fs.readFile(counterPath, "utf8")).toBe("x");
    expect(JSON.parse(await fs.readFile(statePath, "utf8")).detail).toBe("standard");

    const escalateResult = await runCliAsync({
      args: ["escalate", "--show-raw"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(escalateResult.status).toBe(1);
    expect(await fs.readFile(counterPath, "utf8")).toBe("x");
    expect(escalateResult.stdout).toContain(
      "tests/unit/test_auth.py::test_refresh -> assertion failed: expected token"
    );
    expect(escalateResult.stderr).toContain(
      "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token"
    );
    expect(JSON.parse(await fs.readFile(statePath, "utf8")).detail).toBe("focused");

    const secondEscalate = await runCliAsync({
      args: ["escalate", "--show-raw"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(secondEscalate.status).toBe(1);
    expect(await fs.readFile(counterPath, "utf8")).toBe("x");
    expect(JSON.parse(await fs.readFile(statePath, "utf8")).detail).toBe("verbose");
  });

  it("prepends matching diff output for cached test-status reruns", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-diff-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-diff-cwd-"));
    const rawPath = path.join(cwd, "pytest-output.txt");
    const script = [
      "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'));",
      "process.exit(1);"
    ].join(" ");

    await fs.writeFile(
      rawPath,
      await readRealFixture("snapshot-drift-only.txt"),
      "utf8"
    );

    const firstRun = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--",
        "node",
        "-e",
        script,
        rawPath
      ],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(firstRun.status).toBe(1);

    await fs.writeFile(
      rawPath,
      await readRealFixture("single-blocker-short.txt"),
      "utf8"
    );

    const secondRun = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--diff",
        "--",
        "node",
        "-e",
        script,
        rawPath
      ],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(secondRun.status).toBe(1);
    expect(secondRun.stdout).toContain("- Resolved:");
    expect(secondRun.stdout).toContain("- New:");
    expect(secondRun.stdout).toContain("Tests did not pass");
  });

  it("reruns the remaining pytest subset without replacing the cached full-suite truth", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-rerun-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-rerun-cwd-"));
    const pytestPath = path.join(cwd, "pytest");
    const outputPath = path.join(cwd, "pytest-output.txt");
    const argsLogPath = path.join(cwd, "pytest-args.log");
    const script = [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cwd = process.cwd();",
      "fs.appendFileSync(path.join(cwd, 'pytest-args.log'), JSON.stringify(process.argv.slice(2)) + '\\n');",
      "const output = fs.readFileSync(path.join(cwd, 'pytest-output.txt'), 'utf8');",
      "process.stdout.write(output);",
      "process.exit(/(?:^FAILED |^ERROR |\\b\\d+\\s+failed\\b|\\b\\d+\\s+errors?\\b)/m.test(output) ? 1 : 0);"
    ].join("\n");

    await fs.writeFile(pytestPath, script, {
      encoding: "utf8",
      mode: 0o755
    });
    await fs.writeFile(
      outputPath,
      [
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "2 failed in 0.12s"
      ].join("\n"),
      "utf8"
    );

    const firstRun = await runCliAsync({
      args: ["exec", "--preset", "test-status", "--", "./pytest"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(firstRun.status).toBe(1);

    await fs.writeFile(
      outputPath,
      [
        "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user",
        "1 failed in 0.12s"
      ].join("\n"),
      "utf8"
    );

    const fullRerun = await runCliAsync({
      args: ["rerun"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(fullRerun.status).toBe(1);
    expect(fullRerun.stdout).toContain("- Resolved:");
    expect(fullRerun.stdout).toContain("- Remaining:");

    const remainingRerun = await runCliAsync({
      args: ["rerun", "--remaining", "--detail", "verbose", "--show-raw"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(remainingRerun.status).toBe(1);
    expect(remainingRerun.stdout).toContain(
      "tests/unit/test_users.py::test_list -> assertion failed: expected user"
    );
    expect(remainingRerun.stderr).toContain(
      "FAILED tests/unit/test_users.py::test_list - AssertionError: expected user"
    );

    const argLog = (await fs.readFile(argsLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(argLog).toEqual([
      [],
      [],
      ["tests/unit/test_users.py::test_list"]
    ]);
  });

  it("treats standard as the default detail level for test-status", async () => {
    const script = [
      "const lines = [",
      "  '================ 4 errors during collection ================',",
      "  '_ ERROR collecting tests/unit/test_auth.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_auth.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'pydantic'\",",
      "  '_ ERROR collecting tests/unit/test_api.py _',",
      "  \"ImportError while importing test module '/tmp/tests/unit/test_api.py'.\",",
      "  \"E   ModuleNotFoundError: No module named 'fastapi'\"",
      "];",
      "console.error(lines.join('\\n'));",
      "process.exit(2);"
    ].join(" ");

    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--detail",
        "standard",
        "--",
        "node",
        "-e",
        script
      ]
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain(
      "Import/dependency blocker: at least 2 visible errors are caused by missing dependencies during test collection."
    );
    expect(result.stdout).toContain("Missing modules include pydantic, fastapi.");
    expect(result.stdout).toContain("Hint: Install the missing dependencies and rerun the affected tests.");
    expect(result.stdout).not.toContain("->");
  });

  it("explains insufficient test-status output after a successful command", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: "Insufficient signal in the provided input."
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
          "console.log('test runner output without a summary line')"
        ]
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        [
          "Insufficient signal in the provided input.",
          "Hint: command succeeded, but no recognizable test summary was found."
        ].join("\n")
      );
    } finally {
      await server.close();
    }
  });

  it("explains insufficient test-status output after a failing command", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: "Insufficient signal in the provided input."
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
          "console.error('some opaque failure output'); process.exit(3)"
        ]
      });

      expect(result.status).toBe(3);
      expect(result.stdout.trim()).toBe(
        [
          "Insufficient signal in the provided input.",
          "Hint: command failed, but the captured output did not include a recognizable test summary."
        ].join("\n")
      );
    } finally {
      await server.close();
    }
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

  it("fails clearly when --detail is used with unsupported presets", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "--preset",
        "infra-risk",
        "--detail",
        "focused",
        "--shell",
        "printf 'Plan: 2 to add, 1 to destroy\\n'"
      ]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--detail is supported only with --preset test-status.");
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

  it("fails clearly when --detail is used with freeform questions", async () => {
    const result = await runCliAsync({
      args: [
        "exec",
        "did the tests pass?",
        "--detail",
        "focused",
        "--",
        "node",
        "-e",
        "console.log('12 passed')"
      ]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--detail is supported only with --preset test-status.");
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
