import { clearScreenDown, cursorTo, moveCursor } from "node:readline";

export interface KeypressInput {
  isRaw?: boolean;
  resume(): void;
  on(event: "keypress", listener: (value: string, key: { name?: string; ctrl?: boolean }) => void): this;
  off(event: "keypress", listener: (value: string, key: { name?: string; ctrl?: boolean }) => void): this;
  setRawMode?(mode: boolean): void;
}

export interface TerminalOutput {
  write(message: string): void;
}

export function renderSelectionBlock(args: {
  prompt: string;
  options: string[];
  selectedIndex: number;
}): string[] {
  return [
    `${args.prompt} (use ↑/↓ and Enter)`,
    ...args.options.map((option, index) => `${index === args.selectedIndex ? "›" : " "} ${option}`)
  ];
}

export async function promptSelect(args: {
  input: KeypressInput;
  output: TerminalOutput;
  prompt: string;
  options: string[];
  selectedLabel?: string;
}): Promise<string> {
  const { input, output, prompt, options } = args;
  const stream = output as unknown as NodeJS.WriteStream;
  const selectedLabel = args.selectedLabel ?? prompt;
  let index = 0;
  let previousLineCount = 0;

  const render = () => {
    if (previousLineCount > 0) {
      moveCursor(stream, 0, -previousLineCount);
      cursorTo(stream, 0);
      clearScreenDown(stream);
    }

    const lines = renderSelectionBlock({
      prompt,
      options,
      selectedIndex: index
    });

    output.write(`${lines.join("\n")}\n`);
    previousLineCount = lines.length;
  };

  const cleanup = (selected?: string) => {
    if (previousLineCount > 0) {
      moveCursor(stream, 0, -previousLineCount);
      cursorTo(stream, 0);
      clearScreenDown(stream);
    }

    if (selected) {
      output.write(`${selectedLabel}: ${selected}\n`);
    }
  };

  input.resume();
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode?.(true);
  render();

  return await new Promise<string>((resolve, reject) => {
    const onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        input.off("keypress", onKeypress);
        cleanup();
        input.setRawMode?.(wasRaw);
        reject(new Error("Aborted."));
        return;
      }

      if (key.name === "up") {
        index = index === 0 ? options.length - 1 : index - 1;
        render();
        return;
      }

      if (key.name === "down") {
        index = (index + 1) % options.length;
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const selected = options[index] ?? options[0] ?? "";
        input.off("keypress", onKeypress);
        cleanup(selected);
        input.setRawMode?.(wasRaw);
        resolve(selected);
      }
    };

    input.on("keypress", onKeypress);
  });
}

export async function promptSecret(args: {
  input: KeypressInput;
  output: TerminalOutput;
  prompt: string;
}): Promise<string> {
  const { input, output, prompt } = args;
  let value = "";

  output.write(prompt);
  input.resume();
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode?.(true);

  return await new Promise<string>((resolve, reject) => {
    const onKeypress = (chunk: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        input.off("keypress", onKeypress);
        input.setRawMode?.(wasRaw);
        output.write("\n");
        reject(new Error("Aborted."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        input.off("keypress", onKeypress);
        input.setRawMode?.(wasRaw);
        output.write("\n");
        resolve(value);
        return;
      }

      if (key.name === "backspace" || key.name === "delete") {
        value = value.slice(0, -1);
        return;
      }

      if (!key.ctrl && chunk.length > 0) {
        value += chunk;
      }
    };

    input.on("keypress", onKeypress);
  });
}
