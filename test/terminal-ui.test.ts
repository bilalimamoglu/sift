import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { promptSecret, renderSelectionBlock } from "../src/ui/terminal.js";

class FakeKeypressInput extends EventEmitter {
  isRaw = false;

  resume(): void {}

  setRawMode(mode: boolean): void {
    this.isRaw = mode;
  }
}

class FakeOutput {
  buffer = "";

  write(message: string): void {
    this.buffer += message;
  }
}

describe("terminal ui helpers", () => {
  it("renders a clean selection block", () => {
    const lines = renderSelectionBlock({
      prompt: "Select provider",
      options: ["OpenAI"],
      selectedIndex: 0
    });

    expect(lines[0]).toContain("Select provider");
    expect(lines[1]).toBe("› OpenAI");
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
  });
});
