import { afterEach, describe, expect, it, vi } from "vitest";

describe("agent terminal io", () => {
  afterEach(() => {
    vi.doUnmock("node:readline/promises");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("creates the readline interface lazily and reuses it", async () => {
    const question = vi.fn().mockResolvedValue("yes");
    const close = vi.fn();
    const createInterface = vi.fn(() => ({
      question,
      close
    }));

    vi.doMock("node:readline/promises", () => ({
      createInterface
    }));

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { createAgentTerminalIO } = await import("../src/commands/agent.js");

    const io = createAgentTerminalIO();
    io.close?.();

    await expect(io.ask("Prompt: ")).resolves.toBe("yes");
    await expect(io.ask("Prompt again: ")).resolves.toBe("yes");
    expect(createInterface).toHaveBeenCalledTimes(1);
    expect(question).toHaveBeenNthCalledWith(1, "Prompt: ");
    expect(question).toHaveBeenNthCalledWith(2, "Prompt again: ");

    io.write("hello");
    io.error("oops");
    io.close?.();

    expect(stdoutSpy).toHaveBeenCalledWith("hello");
    expect(stderrSpy).toHaveBeenCalledWith("oops");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
