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
    const server = await createFakeOpenAIServer((_body, index) => {
      const payloads = [
        "Changed one file.",
        "- tests passed",
        JSON.stringify({
          status: "ok",
          vulnerabilities: [],
          summary: "No high or critical vulnerabilities found in the provided input."
        })
      ];

      return {
        body: {
          choices: [{ message: { content: payloads[index] } }]
        }
      };
    });

    try {
      const cli = [process.execPath, "dist/cli.js"];
      const env = {
        ...process.env,
        SIFT_BASE_URL: server.baseUrl,
        SIFT_API_KEY: "test-key",
        SIFT_MODEL: "test-model"
      };

      const commands = [
        `${cli.join(" ")} exec "what changed?" -- node -e "console.log('diff --git a/file b/file\\n+change')"`,
        `${cli.join(" ")} exec preset test-status -- node -e "console.log('12 passed')"`,
        `${cli.join(" ")} exec preset audit-critical -- node -e "console.log('critical vuln')"`,
        `${cli.join(" ")} exec preset infra-risk -- node -e "console.log('Plan: 2 to destroy')"`
      ];

      const outputs: string[] = [];

      for (const command of commands) {
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

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
      }

      expect(outputs[0]).toContain("Changed one file.");
      expect(outputs[1]).toContain("tests passed");
      expect(JSON.parse(outputs[2]!)).toEqual({
        status: "ok",
        vulnerabilities: [],
        summary: "No high or critical vulnerabilities found in the provided input."
      });
      expect(JSON.parse(outputs[3]!).verdict).toBe("fail");
    } finally {
      await server.close();
    }
  });
});
