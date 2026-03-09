import { beforeAll, describe, expect, it } from "vitest";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";
import { repoRoot, runCliAsync } from "./helpers/cli.js";
import { execSync } from "node:child_process";

beforeAll(() => {
  execSync("npm run build", {
    cwd: repoRoot(),
    stdio: "pipe"
  });
});

describe("dist e2e", () => {
  it("runs the built cli against a fake provider", async () => {
    const server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "All tests passed." } }]
      }
    }));

    try {
      const result = await runCliAsync({
        useDist: true,
        args: [
          "did tests pass?",
          "--base-url",
          server.baseUrl,
          "--api-key",
          "test-key",
          "--model",
          "test-model"
        ],
        input: "Ran 12 tests\n12 passed\n"
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("All tests passed.");
    } finally {
      await server.close();
    }
  });
});
