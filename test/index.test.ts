import { describe, expect, it } from "vitest";

describe("package export surface", () => {
  it("re-exports the public runtime entry points", async () => {
    const mod = await import("../src/index.js");

    expect(typeof mod.resolveConfig).toBe("function");
    expect(typeof mod.runExec).toBe("function");
    expect(typeof mod.runSift).toBe("function");
  });
});
