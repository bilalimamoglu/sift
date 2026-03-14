import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stderr as defaultStderr, stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { getDefaultGlobalConfigPath } from "../constants.js";
import { loadEditableConfig } from "../config/editable.js";
import { findConfigPath } from "../config/load.js";
import {
  applyActiveProvider,
  getProfileProviderState,
  preserveActiveNativeProviderProfile,
  getStoredProviderProfile,
  setStoredProviderProfile
} from "../config/native-provider.js";
import { getNativeProviderApiKeyEnvName } from "../config/provider-api-key.js";
import { writeConfigFile } from "../config/write.js";
import type { NativeProviderName, ProviderProfile, SiftConfig } from "../types.js";
import { createPresentation } from "../ui/presentation.js";
import { promptSecret, promptSelect } from "../ui/terminal.js";

type SetupProvider = NativeProviderName;
type ApiKeyChoice = "saved" | "env" | "override";

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

function getSetupPresenter(io: ConfigSetupIO) {
  return createPresentation(io.stdoutIsTTY);
}

function getProviderLabel(provider: SetupProvider): string {
  return provider === "openrouter" ? "OpenRouter" : "OpenAI";
}

async function promptForProvider(io: ConfigSetupIO): Promise<SetupProvider> {
  if (io.select) {
    const choice = await io.select("Select provider for this machine", [
      "OpenAI",
      "OpenRouter"
    ]);
    if (choice === "OpenAI") {
      return "openai";
    }

    if (choice === "OpenRouter") {
      return "openrouter";
    }
  }

  while (true) {
    const answer = (await io.ask("Provider [OpenAI/OpenRouter]: "))
      .trim()
      .toLowerCase();

    if (answer === "" || answer === "openai") {
      return "openai";
    }

    if (answer === "openrouter") {
      return "openrouter";
    }

    io.error("Only OpenAI and OpenRouter are supported in guided setup right now.\n");
  }
}

async function promptForApiKey(
  io: ConfigSetupIO,
  provider: SetupProvider
): Promise<string> {
  const providerLabel = getProviderLabel(provider);
  const promptText = `Enter your ${providerLabel} API key (input hidden): `;
  const visiblePromptText = `Enter your ${providerLabel} API key: `;

  while (true) {
    const answer = (
      await (io.secret
        ? io.secret(promptText)
        : io.ask(visiblePromptText))
    ).trim();

    if (answer.length > 0) {
      return answer;
    }

    io.error("API key cannot be empty.\n");
  }
}

async function promptForApiKeyChoice(args: {
  io: ConfigSetupIO;
  provider: SetupProvider;
  envName: string;
  hasSavedKey: boolean;
  hasEnvKey: boolean;
}): Promise<ApiKeyChoice> {
  const providerLabel = getProviderLabel(args.provider);

  if (!args.hasSavedKey && !args.hasEnvKey) {
    return "override";
  }

  if (args.hasSavedKey && args.hasEnvKey) {
    if (args.io.select) {
      const choice = await args.io.select(
        `Found both a saved ${providerLabel} API key and ${args.envName} in your environment`,
        ["Use saved key", "Use env key", "Override"]
      );

      if (choice === "Use saved key") {
        return "saved";
      }

      if (choice === "Use env key") {
        return "env";
      }
    }

    while (true) {
      const answer = (await args.io.ask("API key choice [saved/env/override]: "))
        .trim()
        .toLowerCase();

      if (answer === "" || answer === "saved") {
        return "saved";
      }

      if (answer === "env") {
        return "env";
      }

      if (answer === "override") {
        return "override";
      }

      args.io.error("Please answer saved, env, or override.\n");
    }
  }

  const sourceLabel = args.hasSavedKey ? "saved key" : `${args.envName} from your environment`;
  if (args.io.select) {
    const choice = await args.io.select(
      `Found an existing ${providerLabel} API key via ${sourceLabel}`,
      ["Use existing key", "Override"]
    );

    if (choice === "Override") {
      return "override";
    }

    return args.hasSavedKey ? "saved" : "env";
  }

  while (true) {
    const answer = (await args.io.ask("API key choice [existing/override]: "))
      .trim()
      .toLowerCase();

    if (answer === "" || answer === "existing") {
      return args.hasSavedKey ? "saved" : "env";
    }

    if (answer === "override") {
      return "override";
    }

    args.io.error("Please answer existing or override.\n");
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

function writeProviderDefaults(
  io: ConfigSetupIO,
  provider: SetupProvider
): void {
  const ui = getSetupPresenter(io);

  if (provider === "openrouter") {
    io.write(`${ui.info("Using OpenRouter defaults for your first run.")}\n`);
    io.write(`${ui.labelValue("Default model", "openrouter/free")}\n`);
    io.write(`${ui.labelValue("Default base URL", "https://openrouter.ai/api/v1")}\n`);
  } else {
    io.write(`${ui.info("Using OpenAI defaults for your first run.")}\n`);
    io.write(`${ui.labelValue("Default model", "gpt-5-nano")}\n`);
    io.write(`${ui.labelValue("Default base URL", "https://api.openai.com/v1")}\n`);
  }

  io.write(
    `${ui.note("Want to switch providers later? Run 'sift config use openai' or 'sift config use openrouter'.")}\n`
  );
  io.write(
    `${ui.note("Want to inspect the active values first? Run 'sift config show --show-secrets'.")}\n`
  );
}

function materializeProfile(
  provider: SetupProvider,
  profile: ProviderProfile | undefined,
  apiKey?: string
): ProviderProfile {
  return {
    ...getProfileProviderState(provider, profile),
    ...(apiKey !== undefined ? { apiKey } : {})
  };
}

function buildSetupConfig(args: {
  config: SiftConfig;
  provider: SetupProvider;
  apiKeyChoice: ApiKeyChoice;
  nextApiKey?: string;
}): SiftConfig {
  const preservedConfig = preserveActiveNativeProviderProfile(args.config);
  const storedProfile = getStoredProviderProfile(preservedConfig, args.provider);

  if (args.apiKeyChoice === "saved") {
    const profile = materializeProfile(
      args.provider,
      storedProfile,
      storedProfile?.apiKey ?? ""
    );
    const configWithProfile = setStoredProviderProfile(
      preservedConfig,
      args.provider,
      profile
    );
    return applyActiveProvider(
      configWithProfile,
      args.provider,
      profile,
      profile.apiKey ?? ""
    );
  }

  if (args.apiKeyChoice === "env") {
    const profile = storedProfile
      ? storedProfile
      : materializeProfile(args.provider, undefined);
    const configWithProfile = storedProfile
      ? preservedConfig
      : setStoredProviderProfile(preservedConfig, args.provider, profile);
    return applyActiveProvider(configWithProfile, args.provider, profile, "");
  }

  const profile = materializeProfile(
    args.provider,
    storedProfile,
    args.nextApiKey ?? ""
  );
  const configWithProfile = setStoredProviderProfile(
    preservedConfig,
    args.provider,
    profile
  );
  return applyActiveProvider(
    configWithProfile,
    args.provider,
    profile,
    args.nextApiKey ?? ""
  );
}

export async function configSetup(options: {
  targetPath?: string;
  global?: boolean;
  io?: ConfigSetupIO;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<number> {
  void options.global;
  const io = options.io ?? createTerminalIO();
  const ui = getSetupPresenter(io);
  const env = options.env ?? process.env;

  try {
    if (!io.stdinIsTTY || !io.stdoutIsTTY) {
      io.error(
        "sift config setup is interactive and requires a TTY. Use 'sift config init --global' for a non-interactive template.\n"
      );
      return 1;
    }

    io.write(`${ui.welcome("Let's keep the expensive model for the interesting bits.")}\n`);

    const resolvedPath = resolveSetupPath(options.targetPath);
    const { config: existingConfig, existed } = loadEditableConfig(resolvedPath);
    if (existed) {
      io.write(`${ui.info(`Updating existing config at ${resolvedPath}.`)}\n`);
    }

    const provider = await promptForProvider(io);

    writeProviderDefaults(io, provider);

    const storedProfile = getStoredProviderProfile(existingConfig, provider);
    const envName = getNativeProviderApiKeyEnvName(provider);
    const apiKeyChoice = await promptForApiKeyChoice({
      io,
      provider,
      envName,
      hasSavedKey: Boolean(storedProfile?.apiKey),
      hasEnvKey: Boolean(env[envName])
    });
    const nextApiKey =
      apiKeyChoice === "override"
        ? await promptForApiKey(io, provider)
        : undefined;
    const config = buildSetupConfig({
      config: existingConfig,
      provider,
      apiKeyChoice,
      nextApiKey
    });
    const writtenPath = writeConfigFile({
      targetPath: resolvedPath,
      config,
      overwrite: existed
    });

    if (apiKeyChoice === "env") {
      io.write(
        `${ui.note(`Using ${envName} from the environment. No API key was written to config.`)}\n`
      );
    }

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
