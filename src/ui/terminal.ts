import { execFileSync } from "node:child_process";
import { clearScreenDown, cursorTo, moveCursor } from "node:readline";
import { stdin as defaultStdin } from "node:process";

export const PROMPT_BACK = "__sift_back__";
export const PROMPT_BACK_LABEL = "← Back";

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

function color(text: string, rgb: [number, number, number], args: {
  bold?: boolean;
  dim?: boolean;
} = {}): string {
  const codes: string[] = [];
  if (args.bold) {
    codes.push("1");
  }
  if (args.dim) {
    codes.push("2");
  }
  codes.push(`38;2;${rgb[0]};${rgb[1]};${rgb[2]}`);
  return `\u001B[${codes.join(";")}m${text}\u001B[0m`;
}

function splitOptionLeading(option: string): { leading: string; trailing: string } {
  const boundaries = [" - ", ": ", ":", " ("]
    .map((token) => {
      const index = option.indexOf(token);
      return index >= 0 ? { index, token } : undefined;
    })
    .filter((entry): entry is { index: number; token: string } => Boolean(entry))
    .sort((left, right) => left.index - right.index);

  const boundary = boundaries[0];
  if (!boundary) {
    return { leading: option, trailing: "" };
  }

  return {
    leading: option.slice(0, boundary.index),
    trailing: option.slice(boundary.index)
  };
}

function getOptionPalette(leading: string): {
  rgb: [number, number, number];
  dimWhenIdle?: boolean;
} | undefined {
  const normalized = leading.trim();

  if (normalized.startsWith("With an agent")) {
    return { rgb: [214, 168, 76] };
  }

  if (normalized.startsWith("With provider fallback")) {
    return { rgb: [100, 141, 214] };
  }

  if (normalized.startsWith("Solo, local-only")) {
    return { rgb: [122, 142, 116], dimWhenIdle: true };
  }

  if (normalized.startsWith("Codex")) {
    return { rgb: [233, 183, 78] };
  }

  if (normalized.startsWith("Claude")) {
    return { rgb: [171, 138, 224] };
  }

  if (normalized === "All") {
    return { rgb: [95, 181, 201] };
  }

  if (normalized.startsWith("Global")) {
    return { rgb: [205, 168, 83] };
  }

  if (normalized.startsWith("Local")) {
    return { rgb: [138, 144, 150], dimWhenIdle: true };
  }

  if (normalized.startsWith("OpenAI")) {
    return { rgb: [82, 177, 124] };
  }

  if (normalized.startsWith("OpenRouter")) {
    return { rgb: [106, 144, 221] };
  }

  if (normalized.startsWith("Use saved key") || normalized.startsWith("Use existing key")) {
    return { rgb: [111, 181, 123] };
  }

  if (normalized.startsWith("Use environment key")) {
    return { rgb: [102, 146, 219] };
  }

  if (normalized.startsWith("Enter a different key") || normalized.startsWith("Custom model")) {
    return { rgb: [191, 157, 92], dimWhenIdle: true };
  }

  return undefined;
}

function styleOption(option: string, selected: boolean, colorize: boolean): string {
  if (!colorize) {
    return option;
  }

  if (option === PROMPT_BACK_LABEL) {
    return color(option, [164, 169, 178], { bold: selected, dim: !selected });
  }

  const { leading, trailing } = splitOptionLeading(option);
  const palette = getOptionPalette(leading);
  if (!palette) {
    return option;
  }

  return `${color(leading, palette.rgb, {
    bold: selected,
    dim: !selected && Boolean(palette.dimWhenIdle)
  })}${trailing}`;
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
  allowBack?: boolean;
  backLabel?: string;
  colorize?: boolean;
}): string[] {
  const options = args.allowBack
    ? [...args.options, args.backLabel ?? PROMPT_BACK_LABEL]
    : args.options;

  return [
    `${args.prompt}${args.allowBack ? " (use ↑/↓ to move, Enter to select, Esc to go back)" : " (use ↑/↓ and Enter)"}`,
    ...options.map((option, index) =>
      `${index === args.selectedIndex ? "›" : " "} ${styleOption(
        option,
        index === args.selectedIndex,
        Boolean(args.colorize)
      )}${index === args.selectedIndex ? " (selected)" : ""}`
    )
  ];
}

export async function promptSelect(args: {
  input: KeypressInput;
  output: TerminalOutput;
  prompt: string;
  options: string[];
  selectedLabel?: string;
  allowBack?: boolean;
  backLabel?: string;
}): Promise<string> {
  const { input, output, prompt, options } = args;
  const stream = output as unknown as NodeJS.WriteStream;
  const selectedLabel = args.selectedLabel ?? prompt;
  const backLabel = args.backLabel ?? PROMPT_BACK_LABEL;
  const allOptions = args.allowBack ? [...options, backLabel] : options;
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
      selectedIndex: index,
      allowBack: args.allowBack,
      backLabel,
      colorize: Boolean(stream?.isTTY)
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
        index = index === 0 ? allOptions.length - 1 : index - 1;
        render();
        return;
      }

      if (key.name === "down") {
        index = (index + 1) % allOptions.length;
        render();
        return;
      }

      if (args.allowBack && key.name === "escape") {
        input.off("keypress", onKeypress);
        cleanup();
        input.setRawMode?.(wasRaw);
        input.pause?.();
        resolve(PROMPT_BACK);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const selected = allOptions[index] ?? allOptions[0] ?? "";
        input.off("keypress", onKeypress);
        cleanup(selected === backLabel ? undefined : selected);
        input.setRawMode?.(wasRaw);
        input.pause?.();
        resolve(selected === backLabel ? PROMPT_BACK : selected);
      }
    };

    input.on("keypress", onKeypress);
  });
}

export async function promptSecret(args: {
  input: KeypressInput;
  output: TerminalOutput;
  prompt: string;
  allowBack?: boolean;
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

      if (args.allowBack && key.name === "escape") {
        input.off("keypress", onKeypress);
        restoreInputState();
        output.write("\n");
        resolve(PROMPT_BACK);
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
