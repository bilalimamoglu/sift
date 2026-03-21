import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.e2e.test.ts"],
    globalSetup: ["test/global-setup.e2e.ts"],
    testTimeout: 120_000
  }
});
