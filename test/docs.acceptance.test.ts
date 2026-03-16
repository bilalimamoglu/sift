import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { repoRoot } from "./helpers/cli.js";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";

describe("README quick start acceptance", () => {
  it("supports the documented quick-start commands", async () => {
    const server = await createFakeOpenAIServer((body, _index, request) => {
      const serializedBody = JSON.stringify(body);
      const payload = (() => {
        if (serializedBody.includes("what changed?")) {
          return "Changed one file.";
        }

        if (serializedBody.includes("typecheck-summary")) {
          return "- Typecheck failed\n- TS2322 repeats in src/app.ts";
        }

        if (serializedBody.includes("lint-failures")) {
          return "- Lint failed\n- no-explicit-any is the top repeated rule";
        }

        if (serializedBody.includes("audit-critical")) {
          return JSON.stringify({
            status: "ok",
            vulnerabilities: [],
            summary: "No high or critical vulnerabilities found in the provided input."
          });
        }

        return "- Tests passed";
      })();

      return {
        body: request.path.includes("/responses")
          ? {
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: payload
                    }
                  ]
                }
              ]
            }
          : {
              choices: [{ message: { content: payload } }]
            }
      };
    });

    try {
      const cli = [process.execPath, "dist/cli.js"];
      const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-docs-home-"));
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        SIFT_PROVIDER: "openai",
        SIFT_BASE_URL: server.baseUrl,
        OPENAI_API_KEY: "test-key",
        SIFT_MODEL: "test-model"
      };

      const commands = [
        `${cli.join(" ")} exec "what changed?" -- node -e "console.log('diff --git a/file b/file\\n+change')"`,
        `${cli.join(" ")} exec --preset test-status -- node -e "console.log('12 passed')"`,
        `${cli.join(" ")} exec --preset test-status -- node -e "console.error('FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token'); process.exit(1)"`,
        `${cli.join(" ")} rerun`,
        `${cli.join(" ")} escalate`,
        `${cli.join(" ")} exec --preset typecheck-summary -- node -e "console.error('src/app.ts:1:1 - error TS2322: Type string is not assignable to type number')"`,
        `${cli.join(" ")} exec --preset lint-failures -- node -e "console.error('src/app.ts\\n  1:1  error  Unexpected any  @typescript-eslint/no-explicit-any')"`,
        `${cli.join(" ")} exec --preset audit-critical -- node -e "console.log('critical vuln')"`,
        `${cli.join(" ")} exec --preset infra-risk -- node -e "console.log('Plan: 2 to destroy')"`,
        `${cli.join(" ")} exec --preset audit-critical --fail-on -- node -e "console.log('lodash: critical vulnerability')"`,
        `${cli.join(" ")} exec --preset infra-risk --fail-on -- node -e "console.log('Plan: 2 to destroy')"`,
        `${cli.join(" ")} agent show codex`,
        `${cli.join(" ")} agent show codex --raw`,
        `${cli.join(" ")} agent install codex --dry-run`,
        `${cli.join(" ")} agent install codex --dry-run --raw`
      ];

      const expectedStatuses = [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0];

      const outputs: string[] = [];

      for (const [index, command] of commands.entries()) {
        const result = await new Promise<{
          status: number | null;
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          const child = spawn("bash", ["-lc", command], {
            cwd: repoRoot(),
            env,
            stdio: ["ignore", "pipe", "pipe"]
          });

          let stdout = "";
          let stderr = "";

          child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
          });
          child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
          });
          child.on("error", reject);
          child.on("close", (status) => {
            resolve({
              status,
              stdout,
              stderr
            });
          });
        });

        outputs.push(result.stdout.trim());

        expect(result.status).toBe(expectedStatuses[index]);
        expect(result.stderr).toBe("");
      }

      expect(outputs[0]).toContain("Changed one file.");
      expect(outputs[1]).toBeDefined();
      expect((outputs[1] as string).toLowerCase()).toContain("tests passed");
      expect(outputs[2]).toContain("Tests did not pass");
      expect(outputs[3]).toContain("Tests did not pass");
      expect(outputs[4]).toContain(
        "tests/unit/test_auth.py::test_refresh -> assertion failed: expected token"
      );
      expect(outputs[5]).toContain("Typecheck failed");
      expect(outputs[6]).toContain("Lint failed");
      expect(JSON.parse(outputs[7]!)).toEqual({
        status: "ok",
        vulnerabilities: [],
        summary: "No high or critical vulnerabilities found in the provided input."
      });
      expect(JSON.parse(outputs[8]!).verdict).toBe("fail");
      expect(JSON.parse(outputs[9]!).vulnerabilities).toHaveLength(1);
      expect(outputs[10]).toBeDefined();
      expect(JSON.parse(outputs[10] as string).verdict).toBe("fail");
      expect(outputs[11]).toContain("Codex instructions preview");
      expect(outputs[12]).toContain("<!-- sift:begin codex -->");
      expect(outputs[13]).toContain("Dry run:");
      expect(outputs[13]).toContain("Codex managed block");
      expect(outputs[14]).toContain("<!-- sift:begin codex -->");
    } finally {
      await server.close();
    }
  });
});
