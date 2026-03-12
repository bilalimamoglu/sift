import fs from "node:fs";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stderr as defaultStderr, stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { getDefaultGlobalConfigPath } from "../constants.js";
import { defaultConfig } from "../config/defaults.js";
import { findConfigPath } from "../config/load.js";
import { writeConfigFile } from "../config/write.js";
import type { SiftConfig } from "../types.js";
import { createPresentation } from "../ui/presentation.js";
import { promptSecret, promptSelect } from "../ui/terminal.js";

export interface ConfigSetupIO {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  ask(prompt: string): Promise<string>;
  select?(prompt: string, options: string[]): Promise<string>;
  secret?(prompt: string): Promise<string>;
  write(message: string): void;
  error(message: string): void;
  close?(): void;
}

export function createTerminalIO(): ConfigSetupIO {
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
    emitKeypressEvents(defaultStdin);
    return await promptSelect({
      input: defaultStdin,
      output: defaultStdout,
      prompt,
      options,
      selectedLabel: "Provider"
    });
  }

  async function secret(prompt: string): Promise<string> {
    emitKeypressEvents(defaultStdin);
    return await promptSecret({
      input: defaultStdin,
      output: defaultStdout,
      prompt
    });
  }

  return {
    stdinIsTTY: Boolean(defaultStdin.isTTY),
    stdoutIsTTY: Boolean(defaultStdout.isTTY),
    ask(prompt: string) {
      return getInterface().question(prompt);
    },
    select,
    secret,
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

function getSetupPresenter(io: ConfigSetupIO) {
  return createPresentation(io.stdoutIsTTY);
}

async function promptForProvider(io: ConfigSetupIO): Promise<"openai"> {
  if (io.select) {
    const choice = await io.select("Select provider for this machine", ["OpenAI"]);
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
    const answer = (
      await (io.secret
        ? io.secret("Enter your OpenAI API key (input hidden): ")
        : io.ask("Enter your OpenAI API key: "))
    ).trim();

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

function writeSetupSuccess(io: ConfigSetupIO, writtenPath: string): void {
  const ui = getSetupPresenter(io);

  io.write(`\n${ui.success("You're set.")}\n`);
  io.write(`${ui.info(`Machine-wide config: ${writtenPath}`)}\n`);
  io.write(`${ui.note("sift is ready to use from any terminal on this machine.")}\n`);
  io.write(
    `${ui.note("A repo-local sift.config.yaml can still override it when a project needs its own settings.")}\n`
  );
}

function writeOverrideWarning(io: ConfigSetupIO, activeConfigPath: string): void {
  const ui = getSetupPresenter(io);
  io.write(
    `${ui.warning(`Heads-up: ${activeConfigPath} currently overrides this machine-wide config in this directory.`)}\n`
  );
}

function writeNextSteps(io: ConfigSetupIO): void {
  const ui = getSetupPresenter(io);

  io.write(`\n${ui.section("Try next")}\n`);
  io.write(`  ${ui.command("sift doctor")}\n`);
  io.write(`  ${ui.command("sift exec --preset test-status -- npm test")}\n`);
}

export async function configSetup(options: {
  targetPath?: string;
  global?: boolean;
  io?: ConfigSetupIO;
} = {}): Promise<number> {
  void options.global;
  const io = options.io ?? createTerminalIO();
  const ui = getSetupPresenter(io);

  try {
    if (!io.stdinIsTTY || !io.stdoutIsTTY) {
      io.error(
        "sift config setup is interactive and requires a TTY. Use 'sift config init --global' for a non-interactive template.\n"
      );
      return 1;
    }

    io.write(`${ui.welcome("Let's keep the expensive model for the interesting bits.")}\n`);

    const resolvedPath = resolveSetupPath(options.targetPath);

    if (fs.existsSync(resolvedPath)) {
      const shouldOverwrite = await promptForOverwrite(io, resolvedPath);
      if (!shouldOverwrite) {
        io.write(`${ui.note("Aborted.")}\n`);
        return 1;
      }
    }

    await promptForProvider(io);

    io.write(`${ui.info("Using OpenAI defaults for your first run.")}\n`);
    io.write(`${ui.labelValue("Default model", "gpt-5-nano")}\n`);
    io.write(`${ui.labelValue("Default base URL", "https://api.openai.com/v1")}\n`);
    io.write(
      `${ui.note(`Want to switch providers or tweak defaults later? Edit ${resolvedPath}.`)}\n`
    );
    io.write(
      `${ui.note("Want to inspect the active values first? Run 'sift config show --show-secrets'.")}\n`
    );

    const apiKey = await promptForApiKey(io);
    const config = buildOpenAISetupConfig(apiKey);
    const writtenPath = writeConfigFile({
      targetPath: resolvedPath,
      config,
      overwrite: true
    });

    writeSetupSuccess(io, writtenPath);

    const activeConfigPath = findConfigPath();
    if (activeConfigPath && path.resolve(activeConfigPath) !== path.resolve(writtenPath)) {
      writeOverrideWarning(io, activeConfigPath);
    }

    writeNextSteps(io);
    return 0;
  } finally {
    io.close?.();
  }
}
