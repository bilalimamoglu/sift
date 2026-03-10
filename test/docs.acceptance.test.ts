import { beforeAll, describe, expect, it } from "vitest";
import { execSync, spawn } from "node:child_process";
import { repoRoot } from "./helpers/cli.js";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";

beforeAll(() => {
  execSync("npm run build", {
    cwd: repoRoot(),
    stdio: "pipe"
  });
});

describe("README quick start acceptance", () => {
  it("supports the documented quick-start commands", async () => {
    const server = await createFakeOpenAIServer((_body, index, request) => {
      const payloads = [
        "Changed one file.",
        "- tests passed",
        "- Typecheck failed\n- TS2322 repeats in src/app.ts",
        "- Lint failed\n- no-explicit-any is the top repeated rule",
        JSON.stringify({
          status: "ok",
          vulnerabilities: [],
          summary: "No high or critical vulnerabilities found in the provided input."
        })
      ];

      return {
        body: request.path.includes("/responses")
          ? {
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: payloads[index]
                    }
                  ]
                }
              ]
            }
          : {
              choices: [{ message: { content: payloads[index] } }]
            }
      };
    });

    try {
      const cli = [process.execPath, "dist/cli.js"];
      const env = {
        ...process.env,
        SIFT_PROVIDER: "openai",
        SIFT_BASE_URL: server.baseUrl,
        OPENAI_API_KEY: "test-key",
        SIFT_MODEL: "test-model"
      };

      const commands = [
        `${cli.join(" ")} exec "what changed?" -- node -e "console.log('diff --git a/file b/file\\n+change')"`,
        `${cli.join(" ")} exec --preset test-status -- node -e "console.log('12 passed')"`,
        `${cli.join(" ")} exec --preset typecheck-summary -- node -e "console.error('src/app.ts:1:1 - error TS2322: Type string is not assignable to type number')"`,
        `${cli.join(" ")} exec --preset lint-failures -- node -e "console.error('src/app.ts\\n  1:1  error  Unexpected any  @typescript-eslint/no-explicit-any')"`,
        `${cli.join(" ")} exec --preset audit-critical -- node -e "console.log('critical vuln')"`,
        `${cli.join(" ")} exec --preset infra-risk -- node -e "console.log('Plan: 2 to destroy')"`,
        `${cli.join(" ")} exec --preset audit-critical --fail-on -- node -e "console.log('lodash: critical vulnerability')"`,
        `${cli.join(" ")} exec --preset infra-risk --fail-on -- node -e "console.log('Plan: 2 to destroy')"`
      ];

      const expectedStatuses = [0, 0, 0, 0, 0, 0, 1, 1];

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
      expect(outputs[1]).toContain("tests passed");
      expect(outputs[2]).toContain("Typecheck failed");
      expect(outputs[3]).toContain("Lint failed");
      expect(JSON.parse(outputs[4]!)).toEqual({
        status: "ok",
        vulnerabilities: [],
        summary: "No high or critical vulnerabilities found in the provided input."
      });
      expect(JSON.parse(outputs[5]!).verdict).toBe("fail");
      expect(JSON.parse(outputs[6]!).vulnerabilities).toHaveLength(1);
      expect(JSON.parse(outputs[7]!).verdict).toBe("fail");
    } finally {
      await server.close();
    }
  });
});
