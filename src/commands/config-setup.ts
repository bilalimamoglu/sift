import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stderr as defaultStderr, stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { getDefaultGlobalConfigPath } from "../constants.js";
import { loadEditableConfig } from "../config/editable.js";
import { findConfigPath } from "../config/load.js";
import {
  describeInsufficientBehavior,
  describeOperationMode,
  getOperationModeLabel
} from "../config/operation-mode.js";
import {
  findProviderModelOption,
  getDefaultProviderModel,
  getProviderModelOptions
} from "../config/provider-models.js";
import {
  applyActiveProvider,
  getProfileProviderState,
  preserveActiveNativeProviderProfile,
  getStoredProviderProfile,
  setStoredProviderProfile
} from "../config/native-provider.js";
import { getNativeProviderApiKeyEnvName } from "../config/provider-api-key.js";
import { writeConfigFile } from "../config/write.js";
import type {
  NativeProviderName,
  OperationMode,
  ProviderProfile,
  SiftConfig
} from "../types.js";
import { createPresentation } from "../ui/presentation.js";
import {
  PROMPT_BACK,
  PROMPT_BACK_LABEL,
  promptSecret,
  promptSelect
} from "../ui/terminal.js";

type SetupProvider = NativeProviderName;
type ApiKeyChoice = "saved" | "env" | "override";
export const CONFIG_SETUP_BACK = 2;

export interface ConfigSetupIO {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  ask(prompt: string): Promise<string>;
  select?(
    prompt: string,
    options: string[],
    selectedLabel?: string,
    allowBack?: boolean
  ): Promise<string>;
  secret?(prompt: string, allowBack?: boolean): Promise<string>;
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

  async function select(
    prompt: string,
    options: string[],
    selectedLabel?: string,
    allowBack?: boolean
  ): Promise<string> {
    emitKeypressEvents(defaultStdin);
    return await promptSelect({
      input: defaultStdin,
      output: defaultStdout,
      prompt,
      options,
      selectedLabel,
      allowBack
    });
  }

  async function secret(prompt: string, allowBack?: boolean): Promise<string> {
    emitKeypressEvents(defaultStdin);
    return await promptSecret({
      input: defaultStdin,
      output: defaultStdout,
      prompt,
      allowBack
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

function isBackSelection(value: string): boolean {
  return value === PROMPT_BACK || value === PROMPT_BACK_LABEL;
}

async function promptForOperationMode(io: ConfigSetupIO): Promise<OperationMode> {
  if (io.select) {
    const choice = await io.select(
      "Choose how sift should work",
      [
        "With an agent: recommended if Codex or Claude is already with you; sift does the fast local first pass, the agent only steps in when repo context is truly needed",
        "With provider fallback: recommended if you want sift to finish more ambiguous cases on its own before handing them back to you or your agent; requires an API key, cheap model only when needed",
        "Solo, local-only: recommended if you want zero model calls; great for supported presets, ambiguous cases stay with you"
      ],
      "Mode"
    );

    if (choice.startsWith("With an agent")) {
      return "agent-escalation";
    }

      if (choice.startsWith("With provider fallback")) {
        return "provider-assisted";
    }

    if (choice.startsWith("Solo, local-only")) {
      return "local-only";
    }
  }

  while (true) {
    const answer = (await io.ask("Use style [agent/provider/local]: ")).trim().toLowerCase();

    if (answer === "" || answer === "agent" || answer === "agent-escalation") {
      return "agent-escalation";
    }

    if (answer === "provider" || answer === "provider-assisted") {
      return "provider-assisted";
    }

    if (answer === "local" || answer === "local-only") {
      return "local-only";
    }

    io.error("Please answer agent, provider, or local.\n");
  }
}

async function promptForProvider(io: ConfigSetupIO): Promise<SetupProvider | typeof PROMPT_BACK> {
  if (io.select) {
    const choice = await io.select(
      "Okay, whose API key are we borrowing for fallback duty?",
      [
        "OpenAI",
        "OpenRouter"
      ],
      "Provider",
      true
    );
    if (isBackSelection(choice)) {
      return PROMPT_BACK;
    }
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

    if (answer === "back" || answer === "b") {
      return PROMPT_BACK;
    }

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
): Promise<string | typeof PROMPT_BACK> {
  const providerLabel = getProviderLabel(provider);
  const promptText = `Enter your ${providerLabel} API key (input hidden): `;
  const visiblePromptText = `Enter your ${providerLabel} API key: `;

  while (true) {
    const answer = (
      await (io.secret
        ? io.secret(promptText, true)
        : io.ask(visiblePromptText))
    ).trim();

    if (answer === PROMPT_BACK) {
      return PROMPT_BACK;
    }

    if (!io.secret && (answer.toLowerCase() === "back" || answer.toLowerCase() === "b")) {
      return PROMPT_BACK;
    }

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
}): Promise<ApiKeyChoice | typeof PROMPT_BACK> {
  const providerLabel = getProviderLabel(args.provider);

  if (!args.hasSavedKey && !args.hasEnvKey) {
    return "override";
  }

  if (args.hasSavedKey && args.hasEnvKey) {
    if (args.io.select) {
      const choice = await args.io.select(
        `Found both a saved ${providerLabel} API key and ${args.envName} in your environment`,
        ["Use saved key", "Use environment key", "Enter a different key"],
        "API key",
        true
      );

      if (isBackSelection(choice)) {
        return PROMPT_BACK;
      }

      if (choice === "Use saved key") {
        return "saved";
      }

      if (choice === "Use environment key") {
        return "env";
      }
    }

    while (true) {
      const answer = (await args.io.ask("API key choice [saved/env/override]: "))
        .trim()
        .toLowerCase();

      if (answer === "back" || answer === "b") {
        return PROMPT_BACK;
      }

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
      ["Use saved key", "Enter a different key"],
      "API key",
      true
    );

    if (isBackSelection(choice)) {
      return PROMPT_BACK;
    }

    if (choice === "Enter a different key") {
      return "override";
    }

    return args.hasSavedKey ? "saved" : "env";
  }

  while (true) {
    const answer = (await args.io.ask("API key choice [existing/override]: "))
      .trim()
      .toLowerCase();

    if (answer === "back" || answer === "b") {
      return PROMPT_BACK;
    }

    if (answer === "" || answer === "existing") {
      return args.hasSavedKey ? "saved" : "env";
    }

    if (answer === "override") {
      return "override";
    }

    args.io.error("Please answer existing or override.\n");
  }
}

function writeModeSummary(io: ConfigSetupIO, mode: OperationMode): void {
  const ui = getSetupPresenter(io);
  io.write(`${ui.info(`Operating mode: ${getOperationModeLabel(mode)}`)}\n`);
  io.write(`${ui.note(describeOperationMode(mode))}\n`);
  io.write(`${ui.note(describeInsufficientBehavior(mode))}\n`);

  if (mode === "agent-escalation") {
    io.write(
      `${ui.note("Plain English: pick this if you already use Codex or Claude. sift gives the first answer; the agent only steps in when deeper repo context is really needed. No API key.")}\n`
    );
    return;
  }

  if (mode === "provider-assisted") {
    io.write(
      `${ui.note("Plain English: pick this if you want sift itself to finish more fuzzy cases before you have to step in or re-prompt an agent. Yes, that means an API key, but the model is intentionally the cheap backup, not the fancy main act.")}\n`
    );
    return;
  }

  io.write(
      `${ui.note("Plain English: pick this if sift is working alone. No API key, no model fallback. If the answer is still fuzzy, you inspect the code or logs yourself.")}\n`
  );
}

function writeSetupSuccess(
  io: ConfigSetupIO,
  writtenPath: string,
  mode: OperationMode
): void {
  const ui = getSetupPresenter(io);

  io.write(`\n${ui.success("You're set.")}\n`);
  io.write(`${ui.info(`Machine-wide config: ${writtenPath}`)}\n`);
  io.write(`${ui.labelValue("operation mode", getOperationModeLabel(mode))}\n`);
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

function writeNextSteps(io: ConfigSetupIO, mode: OperationMode): void {
  const ui = getSetupPresenter(io);

  io.write(`\n${ui.section("Try next")}\n`);
  io.write(`  ${ui.command("sift doctor")}\n`);
  if (mode === "provider-assisted") {
    io.write(`  ${ui.command("sift config show --show-secrets")}\n`);
  } else {
    io.write(
      `  ${ui.command("sift config show")}${ui.note("  # rerun setup later if you want provider-assisted fallback")}\n`
    );
  }
  io.write(`  ${ui.command("sift exec --preset test-status -- npm test")}\n`);
}

async function promptForProviderModel(args: {
  io: ConfigSetupIO;
  provider: SetupProvider;
  currentModel?: string;
}): Promise<string | typeof PROMPT_BACK> {
  const options = getProviderModelOptions(args.provider);
  const customCurrent = args.currentModel && !findProviderModelOption(args.provider, args.currentModel)
    ? `Keep current custom model (${args.currentModel})`
    : "Custom model";

  if (args.io.select) {
    const labels = options.map((option) => `${option.label} - ${option.note}`);
    labels.push(customCurrent);
    const choice = await args.io.select(
      "Pick the fallback model. Cheap is usually the right answer here; this only wakes up when sift needs help.",
      labels,
      "Model",
      true
    );
    if (isBackSelection(choice)) {
      return PROMPT_BACK;
    }
    const match = options.find((option) => choice.startsWith(option.label));
    if (match) {
      return match.model;
    }
    if (customCurrent.startsWith("Keep current custom model")) {
      return args.currentModel ?? getDefaultProviderModel(args.provider);
    }
  } else {
    args.io.write("\nPick the fallback model.\n\n");
    options.forEach((option, index) => {
      args.io.write(`  ${index + 1}) ${option.label} - ${option.note}\n`);
    });
    args.io.write(`  ${options.length + 1}) ${customCurrent}\n\n`);

    while (true) {
      const answer = (await args.io.ask("Model choice [1]: ")).trim();
      if (answer.toLowerCase() === "back" || answer.toLowerCase() === "b") {
        return PROMPT_BACK;
      }
      if (answer === "") {
        return options[0]!.model;
      }

      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= options.length) {
        return options[index - 1]!.model;
      }

      if (Number.isInteger(index) && index === options.length + 1) {
        break;
      }

      args.io.error(`Please enter a number between 1 and ${options.length + 1}.\n`);
    }
  }

  while (true) {
    const answer = (await args.io.ask("Custom model id: ")).trim();
    if (answer.toLowerCase() === "back" || answer.toLowerCase() === "b") {
      return PROMPT_BACK;
    }
    if (answer.length > 0) {
      return answer;
    }

    args.io.error("Model id cannot be empty.\n");
  }
}

function writeProviderDefaults(
  io: ConfigSetupIO,
  provider: SetupProvider,
  selectedModel: string
): void {
  const ui = getSetupPresenter(io);
  const options = getProviderModelOptions(provider);

  if (provider === "openrouter") {
    io.write(`${ui.info("OpenRouter fallback it is. Free is lovely right up until latency develops a personality.")}\n`);
    io.write(`${ui.labelValue("Default model", getDefaultProviderModel("openrouter"))}\n`);
    io.write(`${ui.labelValue("Default base URL", "https://openrouter.ai/api/v1")}\n`);
  } else {
    io.write(`${ui.info("OpenAI fallback it is. Start cheap, save the fancy stuff for when the logs deserve it.")}\n`);
    io.write(`${ui.labelValue("Default model", getDefaultProviderModel("openai"))}\n`);
    io.write(`${ui.labelValue("Default base URL", "https://api.openai.com/v1")}\n`);
  }

  io.write(`${ui.labelValue("Selected model", selectedModel)}\n`);
  io.write(
    `${ui.note("This fallback only wakes up when sift's own rules are not enough. The idea is fewer dead ends, not paying for a second opinion on every command.")}\n`
  );
  io.write(`${ui.note("Popular alternatives:")}\n`);
  for (const option of options.filter((option) => option.model !== selectedModel)) {
    io.write(`  ${ui.command(option.label)}${ui.note(`  # ${option.note}`)}\n`);
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
  overrides: {
    apiKey?: string;
    model?: string;
  } = {}
): ProviderProfile {
  return {
    ...profile,
    ...getProfileProviderState(provider, profile),
    ...(overrides.model !== undefined ? { model: overrides.model } : {}),
    ...(overrides.apiKey !== undefined ? { apiKey: overrides.apiKey } : {})
  };
}

function buildSetupConfig(args: {
  config: SiftConfig;
  mode: OperationMode;
  provider?: SetupProvider;
  model?: string;
  apiKeyChoice?: ApiKeyChoice;
  nextApiKey?: string;
}): SiftConfig {
  const preservedConfig = preserveActiveNativeProviderProfile(args.config);
  if (args.mode !== "provider-assisted") {
    return {
      ...preservedConfig,
      runtime: {
        ...preservedConfig.runtime,
        operationMode: args.mode
      }
    };
  }

  if (!args.provider || !args.apiKeyChoice) {
    throw new Error("Provider-assisted setup requires provider and API key choice.");
  }

  const storedProfile = getStoredProviderProfile(preservedConfig, args.provider);

  if (args.apiKeyChoice === "saved") {
    const profile = materializeProfile(
      args.provider,
      storedProfile,
      {
        apiKey: storedProfile?.apiKey ?? "",
        model: args.model
      }
    );
    const configWithProfile = setStoredProviderProfile(
      preservedConfig,
      args.provider,
      profile
    );
    const applied = applyActiveProvider(
      configWithProfile,
      args.provider,
      profile,
      profile.apiKey ?? ""
    );
    return {
      ...applied,
      runtime: {
        ...applied.runtime,
        operationMode: args.mode
      }
    };
  }

  if (args.apiKeyChoice === "env") {
    const profile = materializeProfile(args.provider, storedProfile, {
      model: args.model
    });
    const configWithProfile = setStoredProviderProfile(
      preservedConfig,
      args.provider,
      profile
    );
    const applied = applyActiveProvider(configWithProfile, args.provider, profile, "");
    return {
      ...applied,
      runtime: {
        ...applied.runtime,
        operationMode: args.mode
      }
    };
  }

  const profile = materializeProfile(
    args.provider,
    storedProfile,
    {
      apiKey: args.nextApiKey ?? "",
      model: args.model
    }
  );
  const configWithProfile = setStoredProviderProfile(
    preservedConfig,
    args.provider,
    profile
  );
  const applied = applyActiveProvider(
    configWithProfile,
    args.provider,
    profile,
    args.nextApiKey ?? ""
  );
  return {
    ...applied,
    runtime: {
      ...applied.runtime,
      operationMode: args.mode
    }
  };
}

export async function configSetup(options: {
  targetPath?: string;
  global?: boolean;
  io?: ConfigSetupIO;
  env?: NodeJS.ProcessEnv;
  embedded?: boolean;
  forcedMode?: OperationMode;
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

    if (!options.embedded) {
      io.write(`${ui.welcome("Let's keep the expensive model for the interesting bits.")}\n`);
      io.write(`${ui.note('"Sharp first, expensive later."')}\n`);
    } else {
      io.write(`${ui.info("Next: provider, model, and credentials. Press Esc any time if you want to step back.")}\n`);
    }

    const resolvedPath = resolveSetupPath(options.targetPath);
    const { config: existingConfig, existed } = loadEditableConfig(resolvedPath);
    if (existed) {
      io.write(`${ui.info(`Updating existing config at ${resolvedPath}.`)}\n`);
    }

    let mode = options.forcedMode ?? await promptForOperationMode(io);
    let provider: SetupProvider | undefined;
    let model: string | undefined;
    let apiKeyChoice: ApiKeyChoice | undefined;
    let nextApiKey: string | undefined;
    let modeSummaryShown = false;

    while (true) {
      if (!modeSummaryShown) {
        writeModeSummary(io, mode);
        modeSummaryShown = true;
      }

      if (mode !== "provider-assisted") {
        io.write(
          `${ui.note("No provider credentials are required for this mode. You can switch later by running `sift config setup` again.")}\n`
        );
        break;
      }

      let providerStep: "provider" | "model" | "api-key-choice" | "api-key-entry" = "provider";

      while (true) {
        if (providerStep === "provider") {
          const providerChoice = await promptForProvider(io);
          if (providerChoice === PROMPT_BACK) {
            if (options.forcedMode) {
              return options.embedded ? CONFIG_SETUP_BACK : 1;
            }
            mode = await promptForOperationMode(io);
            modeSummaryShown = false;
            provider = undefined;
            model = undefined;
            apiKeyChoice = undefined;
            nextApiKey = undefined;
            break;
          }

          provider = providerChoice;
          providerStep = "model";
          continue;
        }

        const storedProfile = getStoredProviderProfile(existingConfig, provider!);

        if (providerStep === "model") {
          const modelChoice = await promptForProviderModel({
            io,
            provider: provider!,
            currentModel: storedProfile?.model
          });

          if (modelChoice === PROMPT_BACK) {
            providerStep = "provider";
            continue;
          }

          model = modelChoice;
          writeProviderDefaults(io, provider!, model);
          providerStep = "api-key-choice";
          continue;
        }

        const envName = getNativeProviderApiKeyEnvName(provider!);

        if (providerStep === "api-key-choice") {
          const keyChoice = await promptForApiKeyChoice({
            io,
            provider: provider!,
            envName,
            hasSavedKey: Boolean(storedProfile?.apiKey),
            hasEnvKey: Boolean(env[envName])
          });

          if (keyChoice === PROMPT_BACK) {
            providerStep = "model";
            continue;
          }

          apiKeyChoice = keyChoice;
          if (apiKeyChoice === "override") {
            io.write(`${ui.note("Press Esc if you want to go back instead of entering a key right now.")}\n`);
            providerStep = "api-key-entry";
            continue;
          }

          nextApiKey = undefined;
          break;
        }

        const apiKey = await promptForApiKey(io, provider!);
        if (apiKey === PROMPT_BACK) {
          providerStep = "api-key-choice";
          continue;
        }

        nextApiKey = apiKey;
        break;
      }

      if (mode !== "provider-assisted") {
        continue;
      }

      if (!provider || !apiKeyChoice) {
        continue;
      }

      break;
    }

    const config = buildSetupConfig({
      config: existingConfig,
      mode,
      provider,
      model,
      apiKeyChoice,
      nextApiKey
    });
    const writtenPath = writeConfigFile({
      targetPath: resolvedPath,
      config,
      overwrite: existed
    });

    if (mode === "provider-assisted" && provider && apiKeyChoice === "env") {
      const envName = getNativeProviderApiKeyEnvName(provider);
      io.write(
        `${ui.note(`Using ${envName} from the environment. No API key was written to config.`)}\n`
      );
    }

    writeSetupSuccess(io, writtenPath, mode);

    const activeConfigPath = findConfigPath();
    if (activeConfigPath && path.resolve(activeConfigPath) !== path.resolve(writtenPath)) {
      writeOverrideWarning(io, activeConfigPath);
    }

    writeNextSteps(io, mode);
    return 0;
  } finally {
    io.close?.();
  }
}
