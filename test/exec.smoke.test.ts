import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getScopedTestStatusStatePath } from "../src/constants.js";
import { runSourceCliAsync } from "./helpers/cli.js";

describe("exec mode smoke", () => {
  it("supports dry-run mode without calling the provider", async () => {
    const result = await runSourceCliAsync({
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

  it("uses a local summary for obvious pytest success output", async () => {
    const result = await runSourceCliAsync({
      args: [
        "exec",
        "--preset",
        "test-status",
        "--shell",
        "printf '================ 12 passed, 1 skipped in 0.42s ================\\n'"
      ]
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      ["- Tests passed.", "- 12 tests, 1 skip."].join("\n")
    );
    expect(result.stderr).toBe("");
  });

  it("reuses the cached test-status run during escalate without rerunning the child command", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-escalate-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-escalate-cwd-"));
    const counterPath = path.join(cwd, "counter.txt");
    const statePath = getScopedTestStatusStatePath(cwd, home);
    const script = [
      "const fs = require('node:fs');",
      "fs.appendFileSync(process.argv[1], 'x');",
      "console.error('FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token');",
      "process.exit(1);"
    ].join(" ");

    const execResult = await runSourceCliAsync({
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

    const escalateResult = await runSourceCliAsync({
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
  });

  it("reruns the remaining pytest subset without replacing the cached full-suite truth", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-rerun-home-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-rerun-cwd-"));
    const pytestPath = path.join(cwd, "pytest");
    const outputPath = path.join(cwd, "pytest-output.txt");
    const argsLogPath = path.join(cwd, "pytest-args.log");
    const statePath = getScopedTestStatusStatePath(cwd, home);
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

    const firstRun = await runSourceCliAsync({
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

    const fullRerun = await runSourceCliAsync({
      args: ["rerun"],
      cwd,
      env: {
        HOME: home
      }
    });

    expect(fullRerun.status).toBe(1);
    expect(fullRerun.stdout).toContain("- Remaining:");

    const fullRerunState = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };

    const remainingRerun = await runSourceCliAsync({
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

    const stateAfterRerun = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      rawOutput: string;
    };
    expect(stateAfterRerun.rawOutput).toBe(fullRerunState.rawOutput);
  });

  it("returns exit 1 for infra-risk fail verdicts when --fail-on is enabled", async () => {
    const result = await runSourceCliAsync({
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
});
