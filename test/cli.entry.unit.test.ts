import { afterEach, describe, expect, it, vi } from "vitest";

describe("cli entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("invokes runCli on import", async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const handleCliError = vi.fn();

    vi.doMock("../src/cli-app.js", () => ({
      runCli,
      handleCliError
    }));

    await import("../src/cli.js");

    expect(runCli).toHaveBeenCalled();
    expect(handleCliError).not.toHaveBeenCalled();
  });

  it("routes rejected startup errors through handleCliError", async () => {
    const runCli = vi.fn().mockRejectedValue(new Error("boom"));
    const handleCliError = vi.fn();

    vi.doMock("../src/cli-app.js", () => ({
      runCli,
      handleCliError
    }));

    await import("../src/cli.js");
    await new Promise((resolve) => setImmediate(resolve));

    expect(handleCliError).toHaveBeenCalledWith(expect.any(Error));
  });
});
