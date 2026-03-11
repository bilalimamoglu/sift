import { execFileSync } from "node:child_process";
import { clearScreenDown, cursorTo, moveCursor } from "node:readline";
import { stdin as defaultStdin } from "node:process";

export interface KeypressInput {
  isRaw?: boolean;
  pause?(): void;
  resume(): void;
  on(event: "keypress", listener: (value: string, key: { name?: string; ctrl?: boolean }) => void): this;
  off(event: "keypress", listener: (value: string, key: { name?: string; ctrl?: boolean }) => void): this;
  setRawMode?(mode: boolean): void;
}

export interface TerminalOutput {
  write(message: string): void;
}

function setPosixEcho(enabled: boolean): void {
  const command = enabled ? "echo" : "-echo";

  try {
    execFileSync("sh", ["-c", `stty ${command} < /dev/tty`], {
      stdio: ["inherit", "inherit", "ignore"]
    });
    return;
  } catch {
    // Fall through to a less-targeted best-effort attempt.
  }

  try {
    execFileSync("stty", [command], {
      stdio: ["inherit", "inherit", "ignore"]
    });
  } catch {
    // Best-effort only. Raw mode still provides a partial fallback.
  }
}

export function renderSelectionBlock(args: {
  prompt: string;
  options: string[];
  selectedIndex: number;
}): string[] {
  return [
    `${args.prompt} (use ↑/↓ and Enter)`,
    ...args.options.map((option, index) =>
      `${index === args.selectedIndex ? "›" : " "} ${option}${index === args.selectedIndex ? " (selected)" : ""}`
    )
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
        input.pause?.();
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
        input.pause?.();
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
  const shouldToggleEcho =
    process.platform !== "win32" &&
    input === (defaultStdin as unknown as KeypressInput) &&
    Boolean(defaultStdin.isTTY);

  output.write(prompt);
  input.resume();
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode?.(true);
  if (shouldToggleEcho) {
    setPosixEcho(false);
  }

  return await new Promise<string>((resolve, reject) => {
    const restoreInputState = () => {
      input.setRawMode?.(wasRaw);
      input.pause?.();
      if (shouldToggleEcho) {
        setPosixEcho(true);
      }
    };

    const onKeypress = (chunk: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        input.off("keypress", onKeypress);
        restoreInputState();
        output.write("\n");
        reject(new Error("Aborted."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        input.off("keypress", onKeypress);
        restoreInputState();
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
