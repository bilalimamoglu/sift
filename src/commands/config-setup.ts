import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { clearLine, cursorTo, emitKeypressEvents, moveCursor } from "node:readline";
import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from "node:process";
import {
  getDefaultGlobalConfigPath
} from "../constants.js";
import { defaultConfig } from "../config/defaults.js";
import { findConfigPath } from "../config/load.js";
import { writeConfigFile } from "../config/write.js";
import type { SiftConfig } from "../types.js";

export interface ConfigSetupIO {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  ask(prompt: string): Promise<string>;
  select?(prompt: string, options: string[]): Promise<string>;
  write(message: string): void;
  error(message: string): void;
  close?(): void;
}

function createTerminalIO(): ConfigSetupIO {
  let rl:
    | ReturnType<typeof createInterface>
    | undefined;

  function getInterface() {
    if (!rl) {
      rl = createInterface({
        input: defaultStdin,
        output: defaultStdout,
        terminal: true
      });
    }

    return rl;
  }

  async function select(prompt: string, options: string[]): Promise<string> {
    const input = defaultStdin;
    const output = defaultStdout;
    const promptLine = `${prompt} (use ↑/↓ and Enter)`;
    let index = 0;
    const lineCount = options.length + 1;

    emitKeypressEvents(input);
    input.resume();
    const wasRaw = input.isTTY ? input.isRaw : false;
    input.setRawMode?.(true);

    const render = () => {
      cursorTo(output, 0);
      clearLine(output, 0);
      output.write(`${promptLine}\n`);
      for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
        clearLine(output, 0);
        output.write(`${optionIndex === index ? "›" : " "} ${options[optionIndex]}\n`);
      }
      moveCursor(output, 0, -lineCount);
    };

    render();

    return await new Promise<string>((resolve, reject) => {
      const onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl && key.name === "c") {
          cleanup();
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
          const selected = options[index] ?? options[0];
          cleanup();
          resolve(selected ?? "OpenAI");
        }
      };

      const cleanup = () => {
        input.off("keypress", onKeypress);
        moveCursor(output, 0, lineCount);
        cursorTo(output, 0);
        clearLine(output, 0);
        output.write("\n");
        input.setRawMode?.(Boolean(wasRaw));
      };

      input.on("keypress", onKeypress);
    });
  }

  return {
    stdinIsTTY: Boolean(defaultStdin.isTTY),
    stdoutIsTTY: Boolean(defaultStdout.isTTY),
    ask(prompt: string) {
      return getInterface().question(prompt);
    },
    select,
    write(message: string) {
      defaultStdout.write(message);
    },
    error(message: string) {
      defaultStderr.write(message);
    },
    close() {
      rl?.close();
    }
  };
}

export function resolveSetupPath(targetPath?: string): string {
  return targetPath ? path.resolve(targetPath) : getDefaultGlobalConfigPath();
}

function buildOpenAISetupConfig(apiKey: string): SiftConfig {
  return {
    ...defaultConfig,
    provider: {
      ...defaultConfig.provider,
      provider: "openai",
      model: "gpt-5-nano",
      baseUrl: "https://api.openai.com/v1",
      apiKey
    }
  };
}

async function promptForProvider(io: ConfigSetupIO): Promise<"openai"> {
  if (io.select) {
    const choice = await io.select("Select provider", ["OpenAI"]);
    if (choice === "OpenAI") {
      return "openai";
    }
  }

  while (true) {
    const answer = (await io.ask("Provider [OpenAI]: ")).trim().toLowerCase();

    if (answer === "" || answer === "openai") {
      return "openai";
    }

    io.error("Only OpenAI is supported in guided setup right now.\n");
  }
}

async function promptForApiKey(io: ConfigSetupIO): Promise<string> {
  while (true) {
    const answer = (await io.ask("Enter your OpenAI API key: ")).trim();
    if (answer.length > 0) {
      return answer;
    }

    io.error("API key cannot be empty.\n");
  }
}

async function promptForOverwrite(io: ConfigSetupIO, targetPath: string): Promise<boolean> {
  while (true) {
    const answer = (await io.ask(
      `Config file already exists at ${targetPath}. Overwrite? [y/N]: `
    ))
      .trim()
      .toLowerCase();

    if (answer === "" || answer === "n" || answer === "no") {
      return false;
    }

    if (answer === "y" || answer === "yes") {
      return true;
    }

    io.error("Please answer y or n.\n");
  }
}

export async function configSetup(options: {
  targetPath?: string;
  global?: boolean;
  io?: ConfigSetupIO;
} = {}): Promise<number> {
  void options.global;
  const io = options.io ?? createTerminalIO();
  try {
    if (!io.stdinIsTTY || !io.stdoutIsTTY) {
      io.error(
        "sift config setup is interactive and requires a TTY. Use 'sift config init --global' for a non-interactive template.\n"
      );
      return 1;
    }

    const resolvedPath = resolveSetupPath(options.targetPath);

    if (fs.existsSync(resolvedPath)) {
      const shouldOverwrite = await promptForOverwrite(io, resolvedPath);
      if (!shouldOverwrite) {
        io.write("Aborted.\n");
        return 1;
      }
    }

    const provider = await promptForProvider(io);
    if (provider !== "openai") {
      io.error("Unsupported provider selection.\n");
      return 1;
    }

    io.write("Using OpenAI defaults.\n");
    io.write("Default model: gpt-5-nano\n");
    io.write("Default base URL: https://api.openai.com/v1\n");
    io.write(
      "You can change these later by editing the config file or running 'sift config show --show-secrets'.\n"
    );

    const apiKey = await promptForApiKey(io);
    const config = buildOpenAISetupConfig(apiKey);
    const writtenPath = writeConfigFile({
      targetPath: resolvedPath,
      config,
      overwrite: true
    });

    io.write(`Wrote ${writtenPath}\n`);
    io.write(
      "This is your machine-wide default config. Repo-local sift.config.yaml can still override it later.\n"
    );
    const activeConfigPath = findConfigPath();
    if (activeConfigPath && path.resolve(activeConfigPath) !== path.resolve(writtenPath)) {
      io.write(
        `Note: ${activeConfigPath} currently overrides this machine-wide config in the current directory.\n`
      );
    }
    io.write("Try:\n");
    io.write("  sift doctor\n");
    io.write("  sift exec --preset test-status -- pytest\n");

    return 0;
  } finally {
    io.close?.();
  }
}
