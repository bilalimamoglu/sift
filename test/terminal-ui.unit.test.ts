import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  promptSecret,
  promptSelect,
  renderSelectionBlock
} from "../src/ui/terminal.js";

class FakeKeypressInput extends EventEmitter {
  isRaw = false;
  pauseCalls = 0;
  rawTransitions: boolean[] = [];

  resume(): void {}

  pause(): void {
    this.pauseCalls += 1;
  }

  setRawMode(mode: boolean): void {
    this.isRaw = mode;
    this.rawTransitions.push(mode);
  }
}

class FakeOutput {
  buffer = "";

  write(message: string): void {
    this.buffer += message;
  }
}

describe("terminal ui helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unmock("node:child_process");
  });

  it("renders a clean selection block", () => {
    const lines = renderSelectionBlock({
      prompt: "Select provider",
      options: ["OpenAI"],
      selectedIndex: 0
    });

    expect(lines[0]).toContain("Select provider");
    expect(lines[1]).toBe("› OpenAI (selected)");
  });

  it("captures secret input without echoing typed characters", async () => {
    const input = new FakeKeypressInput();
    const output = new FakeOutput();

    const pending = promptSecret({
      input,
      output,
      prompt: "Enter your OpenAI API key (input hidden): "
    });

    input.emit("keypress", "s", { name: "s" });
    input.emit("keypress", "k", { name: "k" });
    input.emit("keypress", "-", { name: undefined });
    input.emit("keypress", "x", { name: "x" });
    input.emit("keypress", "", { name: "backspace" });
    input.emit("keypress", "y", { name: "y" });
    input.emit("keypress", "", { name: "return" });

    await expect(pending).resolves.toBe("sk-y");
    expect(output.buffer).toBe("Enter your OpenAI API key (input hidden): \n");
    expect(input.pauseCalls).toBe(1);
  });

  it("accepts the enter key alias for prompts", async () => {
    const selectInput = new FakeKeypressInput();
    const selectOutput = new FakeOutput();
    const selectPending = promptSelect({
      input: selectInput,
      output: selectOutput,
      prompt: "Select provider for this machine",
      options: ["OpenAI"],
      selectedLabel: "Provider"
    });

    selectInput.emit("keypress", "", { name: "enter" });
    await expect(selectPending).resolves.toBe("OpenAI");

    const secretInput = new FakeKeypressInput();
    const secretOutput = new FakeOutput();
    const secretPending = promptSecret({
      input: secretInput,
      output: secretOutput,
      prompt: "Enter your OpenAI API key (input hidden): "
    });

    secretInput.emit("keypress", "k", { name: "k" });
    secretInput.emit("keypress", "", { name: "enter" });
    await expect(secretPending).resolves.toBe("k");
  });

  it("supports interactive selection with arrow keys and enter", async () => {
    const input = new FakeKeypressInput();
    const output = new FakeOutput();

    const pending = promptSelect({
      input,
      output,
      prompt: "Select provider for this machine",
      options: ["OpenAI", "OpenAI Compatible"],
      selectedLabel: "Provider"
    });

    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "return" });

    await expect(pending).resolves.toBe("OpenAI Compatible");
    expect(output.buffer).toContain("Select provider for this machine");
    expect(output.buffer).toContain("› OpenAI Compatible (selected)");
    expect(output.buffer).toContain("Provider: OpenAI Compatible");
    expect(input.pauseCalls).toBe(1);
    expect(input.isRaw).toBe(false);
  });

  it("wraps upward selection and restores prior raw state", async () => {
    const input = new FakeKeypressInput();
    input.isRaw = true;
    const output = new FakeOutput();

    const pending = promptSelect({
      input,
      output,
      prompt: "Select provider for this machine",
      options: ["OpenAI", "OpenAI Compatible"],
      selectedLabel: "Provider"
    });

    input.emit("keypress", "", { name: "up" });
    input.emit("keypress", "", { name: "return" });

    await expect(pending).resolves.toBe("OpenAI Compatible");
    expect(input.rawTransitions).toEqual([true, true]);
  });

  it("moves upward within the list and handles empty option lists", async () => {
    const input = new FakeKeypressInput();
    const output = new FakeOutput();

    const withinList = promptSelect({
      input,
      output,
      prompt: "Select provider for this machine",
      options: ["OpenAI", "OpenAI Compatible"],
      selectedLabel: "Provider"
    });

    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "up" });
    input.emit("keypress", "", { name: "return" });

    await expect(withinList).resolves.toBe("OpenAI");

    const emptyInput = new FakeKeypressInput();
    const emptyOutput = new FakeOutput();
    const emptySelection = promptSelect({
      input: emptyInput,
      output: emptyOutput,
      prompt: "Select provider for this machine",
      options: [],
      selectedLabel: "Provider"
    });

    emptyInput.emit("keypress", "", { name: "return" });
    await expect(emptySelection).resolves.toBe("");
    expect(emptyOutput.buffer).toContain("Select provider for this machine");
    expect(emptyOutput.buffer).not.toContain("Provider:");
  });

  it("aborts select and secret prompts on Ctrl+C", async () => {
    const input = new FakeKeypressInput();
    const output = new FakeOutput();

    const pendingSelect = promptSelect({
      input,
      output,
      prompt: "Select provider for this machine",
      options: ["OpenAI"]
    });

    input.emit("keypress", "", { name: "c", ctrl: true });
    await expect(pendingSelect).rejects.toThrow("Aborted.");

    const pendingSecret = promptSecret({
      input,
      output,
      prompt: "Enter your OpenAI API key (input hidden): "
    });

    input.emit("keypress", "", { name: "c", ctrl: true });
    await expect(pendingSecret).rejects.toThrow("Aborted.");
    expect(input.pauseCalls).toBe(2);
  });

  it("toggles terminal echo for real stdin on posix platforms", async () => {
    vi.resetModules();
    const execFileSync = vi.fn();
    vi.doMock("node:child_process", () => ({
      execFileSync
    }));

    const terminal = await import("../src/ui/terminal.js");
    const input = process.stdin as unknown as FakeKeypressInput;
    const originalIsTTY = process.stdin.isTTY;
    const originalSetRawMode = process.stdin.setRawMode;
    const originalResume = process.stdin.resume;
    const originalPause = process.stdin.pause;
    const output = new FakeOutput();

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true
    });
    (process.stdin as any).setRawMode = vi.fn();
    (process.stdin as any).resume = vi.fn();
    (process.stdin as any).pause = vi.fn();

    try {
      const pending = terminal.promptSecret({
        input,
        output,
        prompt: "Enter your OpenAI API key (input hidden): "
      });

      process.stdin.emit("keypress", "s", { name: "s" });
      process.stdin.emit("keypress", "", { name: "return" });

      await expect(pending).resolves.toBe("s");
      if (process.platform !== "win32") {
        expect(execFileSync).toHaveBeenCalledWith(
          "sh",
          ["-c", "stty -echo < /dev/tty"],
          expect.any(Object)
        );
        expect(execFileSync).toHaveBeenCalledWith(
          "sh",
          ["-c", "stty echo < /dev/tty"],
          expect.any(Object)
        );
      }
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
      (process.stdin as any).setRawMode = originalSetRawMode;
      (process.stdin as any).resume = originalResume;
      (process.stdin as any).pause = originalPause;
    }
  });

  it("ignores stty failures and keeps collecting secret input", async () => {
    vi.resetModules();
    const execFileSync = vi.fn(() => {
      throw new Error("stty unavailable");
    });
    vi.doMock("node:child_process", () => ({
      execFileSync
    }));

    const terminal = await import("../src/ui/terminal.js");
    const input = process.stdin as unknown as FakeKeypressInput;
    const originalIsTTY = process.stdin.isTTY;
    const originalSetRawMode = process.stdin.setRawMode;
    const originalResume = process.stdin.resume;
    const originalPause = process.stdin.pause;
    const output = new FakeOutput();

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true
    });
    (process.stdin as any).setRawMode = vi.fn();
    (process.stdin as any).resume = vi.fn();
    (process.stdin as any).pause = vi.fn();

    try {
      const pending = terminal.promptSecret({
        input,
        output,
        prompt: "Enter your OpenAI API key (input hidden): "
      });

      process.stdin.emit("keypress", "x", { name: "x" });
      process.stdin.emit("keypress", "", { name: "return" });

      await expect(pending).resolves.toBe("x");
      expect(execFileSync).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
      (process.stdin as any).setRawMode = originalSetRawMode;
      (process.stdin as any).resume = originalResume;
      (process.stdin as any).pause = originalPause;
    }
  });
});
