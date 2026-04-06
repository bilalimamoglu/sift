import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import {
  stderr as defaultStderr,
  stdin as defaultStdin,
  stdout as defaultStdout
} from "node:process";
import {
  getDefaultGlobalConfigPath,
  getDefaultClaudeGlobalCommandsDir,
  getDefaultClaudeGlobalInstructionsPath,
  getDefaultCodexGlobalInstructionsPath,
  getDefaultCopilotInstructionsPath,
  getDefaultCursorGlobalSkillPath
} from "../constants.js";
import {
  describeOperationMode,
  getOperationModeLabel
} from "../config/operation-mode.js";
import {
  getDefaultExecPathLine,
  getHookBetaLine,
  getInstallExplainLine
} from "../content/adoption.js";
import { CONFIG_SETUP_BACK, configSetup } from "./config-setup.js";
import type { OperationMode } from "../types.js";
import { createPresentation } from "../ui/presentation.js";
import { PROMPT_BACK, promptSelect } from "../ui/terminal.js";
import { resolveSharedGuideTargetPath } from "../shared-guide.js";
import {
  installAgent,
  type AgentCommandIO,
  type AgentName,
  type AgentScope
} from "./agent.js";
import { CLAUDE_COMMAND_NAMES } from "../runtime-payloads/claude-commands.js";
import { renderCopilotInstructions } from "../runtime-payloads/copilot-instructions.js";
import { installSkill, type SkillRuntime } from "./skill.js";

export type InstallRuntime = AgentName | SkillRuntime | "copilot" | "all";

export interface InstallRuntimeIO extends AgentCommandIO {
  select?(
    prompt: string,
    options: string[],
    selectedLabel?: string,
    allowBack?: boolean
  ): Promise<string>;
}

interface MenuChoice<T> {
  readonly label: string;
  readonly value: T;
}

const INSTALL_TITLES: Record<Exclude<InstallRuntime, "all">, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  copilot: "Copilot"
};

export function createInstallTerminalIO(): InstallRuntimeIO {
  let rl: ReturnType<typeof createInterface> | undefined;

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

export function normalizeInstallRuntime(value: unknown): InstallRuntime | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "codex" || value === "claude" || value === "cursor" || value === "copilot" || value === "all") {
    return value;
  }

  throw new Error("Invalid runtime. Use codex, claude, cursor, copilot, or all.");
}

export function normalizeInstallScope(value: unknown): AgentScope | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "global") {
    return "global";
  }

  if (value === "local" || value === "repo") {
    return "repo";
  }

  throw new Error("Invalid --scope value. Use local or global.");
}

function renderInstallBanner(version: string): string {
  const teal = (text: string) =>
    `\u001B[38;2;34;173;169m${text}\u001B[0m`;

  return [
    teal("  ███████╗██╗███████╗████████╗"),
    teal("  ██╔════╝██║██╔════╝╚══██╔══╝"),
    teal("  ███████╗██║█████╗     ██║   "),
    teal("  ╚════██║██║██╔══╝     ██║   "),
    teal("  ███████║██║██║        ██║   "),
    teal("  ╚══════╝╚═╝╚═╝        ╚═╝   "),
    "",
    `  sift v${version}`,
    "  Small, sharp, and mildly sarcastic output guidance.",
    '  "Loading the loading screen..." energy, minus the loading screen.'
  ].join("\n");
}

function getInstallTargets(runtime: InstallRuntime): Exclude<InstallRuntime, "all">[] {
  if (runtime === "all") {
    return ["codex", "claude"];
  }

  return [runtime];
}

function getGlobalTargetLabel(runtime: Exclude<InstallRuntime, "all">, homeDir = os.homedir()): string {
  if (runtime === "codex") {
    return getDefaultCodexGlobalInstructionsPath(homeDir);
  }
  if (runtime === "claude") {
    return getDefaultClaudeGlobalInstructionsPath(homeDir);
  }
  return getDefaultCursorGlobalSkillPath(homeDir);
}

function getLocalTargetLabel(runtime: Exclude<InstallRuntime, "all">, cwd = process.cwd()): string {
  if (runtime === "codex") {
    return path.join(cwd, "AGENTS.md");
  }
  if (runtime === "claude") {
    return path.join(cwd, "CLAUDE.md");
  }
  if (runtime === "copilot") {
    return getDefaultCopilotInstructionsPath(cwd);
  }
  return path.join(cwd, ".cursor", "skills", "sift", "SKILL.md");
}

function describeScopeChoice(args: {
  runtime: InstallRuntime;
  scope: AgentScope;
  cwd?: string;
  homeDir?: string;
}): string {
  const targets = getInstallTargets(args.runtime);
  const labels = targets.map((agent) =>
    args.runtime === "copilot"
      ? getLocalTargetLabel("copilot", args.cwd)
      : args.scope === "global"
      ? getGlobalTargetLabel(agent, args.homeDir)
      : getLocalTargetLabel(agent, args.cwd)
  );

  return labels.join(" + ");
}

function getCopilotInstructionsTargetPath(cwd?: string): string {
  return getDefaultCopilotInstructionsPath(cwd ?? process.cwd());
}

function inspectCopilotInstructionsOwnership(content: string | undefined): "managed" | "custom" | "missing" {
  if (content === undefined) {
    return "missing";
  }

  return content.includes("<!-- sift:generated copilot-instructions -->") ? "managed" : "custom";
}

function readOptionalFile(targetPath: string): string | undefined {
  if (!fs.existsSync(targetPath)) {
    return undefined;
  }

  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error(`${targetPath} exists but is not a file.`);
  }

  return fs.readFileSync(targetPath, "utf8");
}

function writeTextFileAtomic(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, targetPath);
}

async function promptWithMenu<T>(args: {
  io: InstallRuntimeIO;
  prompt: string;
  choices: MenuChoice<T>[];
  defaultIndex?: number;
  selectedLabel: string;
  allowBack?: boolean;
}): Promise<T | typeof PROMPT_BACK> {
  const defaultIndex = args.defaultIndex ?? 0;

  if (args.io.select) {
    const labels = args.choices.map((choice) => choice.label);
    const selected = await args.io.select(args.prompt, labels, args.selectedLabel, args.allowBack);
    if (selected === PROMPT_BACK) {
      return PROMPT_BACK;
    }
    const match = args.choices.find((choice) => choice.label === selected);
    if (match) {
      return match.value;
    }
  }

  args.io.write(`\n${args.prompt}\n\n`);
  args.choices.forEach((choice, index) => {
    args.io.write(`  ${index + 1}) ${choice.label}\n`);
  });
  if (args.allowBack) {
    args.io.write(`  ${args.choices.length + 1}) Back\n`);
  }
  args.io.write("\n");

  while (true) {
    const answer = (await args.io.ask(`Choice [${defaultIndex + 1}]: `)).trim();
    if (args.allowBack && (answer.toLowerCase() === "back" || answer.toLowerCase() === "b")) {
      return PROMPT_BACK;
    }
    if (answer === "") {
      return args.choices[defaultIndex]?.value ?? args.choices[0]!.value;
    }

    const choiceIndex = Number(answer);
    if (Number.isInteger(choiceIndex) && choiceIndex >= 1 && choiceIndex <= args.choices.length) {
      return args.choices[choiceIndex - 1]!.value;
    }
    if (args.allowBack && Number.isInteger(choiceIndex) && choiceIndex === args.choices.length + 1) {
      return PROMPT_BACK;
    }

    const max = args.allowBack ? args.choices.length + 1 : args.choices.length;
    args.io.error(`Please enter a number between 1 and ${max}.\n`);
  }
}

async function promptForRuntime(io: InstallRuntimeIO): Promise<InstallRuntime | typeof PROMPT_BACK> {
  return await promptWithMenu({
    io,
    prompt: "Choose your runtime",
    selectedLabel: "Runtime",
    allowBack: true,
    choices: [
      {
        label: "Codex   (AGENTS.md / ~/.codex/AGENTS.md) - first-class if you live in Codex",
        value: "codex"
      },
      {
        label: "Claude  (CLAUDE.md / ~/.claude/CLAUDE.md) - same good manners, Claude-flavored",
        value: "claude"
      },
      {
        label: "Cursor  (.cursor/skills/sift/SKILL.md / ~/.cursor/skills/sift/SKILL.md) - native skill path for Cursor without inventing a second runtime",
        value: "cursor"
      },
      {
        label: "Copilot (.github/copilot-instructions.md) - repository instructions for GitHub Copilot, repo-only by design",
        value: "copilot"
      },
      {
        label: "All      - Codex + Claude together if you refuse to pick favorites today",
        value: "all"
      }
    ]
  });
}

async function promptForScope(args: {
  io: InstallRuntimeIO;
  runtime: InstallRuntime;
  cwd?: string;
  homeDir?: string;
}): Promise<AgentScope | typeof PROMPT_BACK> {
  return await promptWithMenu({
    io: args.io,
    prompt: "Choose where to install the runtime support",
    selectedLabel: "Location",
    allowBack: true,
    choices: [
      {
        label: `Global (${describeScopeChoice({
          runtime: args.runtime,
          scope: "global",
          cwd: args.cwd,
          homeDir: args.homeDir
        })}) - use this if you want sift ready everywhere`,
        value: "global"
      },
      {
        label: `Local  (${describeScopeChoice({
          runtime: args.runtime,
          scope: "repo",
          cwd: args.cwd,
          homeDir: args.homeDir
        })}) - keep it here if this repo is the only one that matters`,
        value: "repo"
      }
    ]
  });
}

async function promptForOperationMode(io: InstallRuntimeIO): Promise<OperationMode | typeof PROMPT_BACK> {
  return await promptWithMenu({
    io,
    prompt: "Choose how sift should work",
    selectedLabel: "Mode",
    allowBack: true,
    choices: [
      {
        label: "With an agent - recommended if Codex or Claude is already with you; sift does the fast local first pass, the agent only steps in when repo context is truly needed",
        value: "agent-escalation"
      },
      {
        label: "With provider fallback - recommended if you want sift to finish more ambiguous cases on its own before handing them back to you or your agent; needs an API key, cheap model only when needed",
        value: "provider-assisted"
      },
      {
        label: "Solo, local-only - recommended if you want zero model calls; great for supported presets, ambiguous cases stay with you",
        value: "local-only"
      }
    ]
  });
}

function createNestedInstallIO(parent: InstallRuntimeIO): AgentCommandIO {
  return {
    stdinIsTTY: parent.stdinIsTTY,
    stdoutIsTTY: parent.stdoutIsTTY,
    ask: async () => "",
    write() {},
    error(message: string) {
      parent.error(message);
    }
  };
}

function writeSuccessSummary(args: {
  io: InstallRuntimeIO;
  version: string;
  runtime: InstallRuntime;
  scope: AgentScope;
  operationMode: OperationMode;
  cwd?: string;
  homeDir?: string;
}): void {
  const ui = createPresentation(args.io.stdoutIsTTY);
  const targets = getInstallTargets(args.runtime);
  const scopeLabel = args.scope === "global" ? "global" : "local";

  if (args.io.stdoutIsTTY) {
    args.io.write(`\n${ui.success("Installed runtime support.")}\n`);
  } else {
    args.io.write("Installed runtime support.\n");
  }

  if (targets.includes("copilot")) {
    const targetLabel = getCopilotInstructionsTargetPath(args.cwd);
    args.io.write(`${ui.note("Copilot instructions installed for this repository.")}\n`);
    args.io.write(`${ui.note(`Repo-local instructions live at ${targetLabel}.`)}\n`);
    args.io.write(`${ui.note("Copilot is repo-only here; there is no global install target.")}\n`);
    args.io.write(`\n${ui.section("Try next")}\n`);
    args.io.write(`  ${ui.command("sift exec --preset test-status -- pytest -q")}${ui.note("  # default first pass")}\n`);
    args.io.write(`  ${ui.command("sift doctor")}${ui.note("  # verify the setup and see what happens on ambiguous cases")}\n`);
    args.io.write(`${ui.note(getDefaultExecPathLine())}\n`);
    args.io.write(`${ui.note(getHookBetaLine())}\n`);
    return;
  }

  const targetLabel = describeScopeChoice({
    runtime: args.runtime,
    scope: args.scope,
    cwd: args.cwd,
    homeDir: args.homeDir
  });

  args.io.write(
    `${ui.note(`Runtime instructions installed for ${targets.map((target) => INSTALL_TITLES[target]).join(" + ")} in ${scopeLabel} scope.`)}\n`
  );
  args.io.write(`${ui.note(getInstallExplainLine())}\n`);
  args.io.write(`${ui.note(`Operating mode: ${getOperationModeLabel(args.operationMode)}`)}\n`);
  args.io.write(`${ui.note(describeOperationMode(args.operationMode))}\n`);
  args.io.write(`${ui.note(targetLabel)}\n`);
  args.io.write(
    `${ui.note(
      `Shared SIFT guide: ${resolveSharedGuideTargetPath({
        scope: args.scope,
        cwd: args.cwd,
        homeDir: args.homeDir
      })}`
    )}\n`
  );
  if (targets.includes("codex")) {
    args.io.write(`${ui.note("Codex install also writes a tiny generated SKILL.md so Codex has a native `sift` entry point.")}\n`);
  }
  if (targets.includes("claude")) {
    args.io.write(`${ui.note("Claude install also writes a tiny `.claude/commands/sift/` command pack so Claude has native `sift` entry points.")}\n`);
  }
  if (targets.includes("cursor")) {
    args.io.write(
      `${ui.note("Cursor install writes a tiny native `.cursor/skills/sift/SKILL.md` workflow guide and avoids rules/runtime-platform drift.")}\n`
    );
  }
  args.io.write(`${ui.note("The CLI is still the real runtime. The native files are guidance surfaces, not a second execution system.")}\n`);
  args.io.write(`\n${ui.section("Try next")}\n`);
  args.io.write(`  ${ui.command("sift exec --preset test-status -- pytest -q")}${ui.note("  # default first pass")}\n`);
  args.io.write(`  ${ui.command("sift doctor")}${ui.note("  # verify the setup and see what happens on ambiguous cases")}\n`);
  args.io.write(`  ${ui.command("sift hook match -- pytest -q")}${ui.note("  # optional beta shortcut for known presets")}\n`);
  if (args.operationMode === "provider-assisted") {
    args.io.write(`  ${ui.command("sift config show --show-secrets")}\n`);
  } else {
    args.io.write(
      `  ${ui.command("sift config setup")}${ui.note("  # optional if you want provider-assisted fallback later")}\n`
    );
  } 
  args.io.write(`${ui.note(getDefaultExecPathLine())}\n`);
  args.io.write(`${ui.note(getHookBetaLine())}\n`);
}

function writePreflightSummary(args: {
  io: InstallRuntimeIO;
  runtime: InstallRuntime;
  scope: AgentScope;
  operationMode: OperationMode;
  cwd?: string;
  homeDir?: string;
}): void {
  const ui = createPresentation(args.io.stdoutIsTTY);
  const runtimeTargets = getInstallTargets(args.runtime);
  if (runtimeTargets.includes("copilot")) {
    const targetPath = getCopilotInstructionsTargetPath(args.cwd);

    args.io.write(`\n${ui.section("Install preflight")}\n`);
    args.io.write(`${ui.note("Will write repo-local instructions for GitHub Copilot:")}\n`);
    args.io.write(`  ${ui.command(targetPath)}\n`);
    args.io.write(`${ui.note("Will not write shell rc files, PATH entries, git hooks, or arbitrary repo files.")}\n`);
    args.io.write(`${ui.note("Managed files update only when sift can prove ownership.")}\n`);
    return;
  }

  const writeTargets = runtimeTargets.flatMap((runtime) => {
    const sharedGuidePath = resolveSharedGuideTargetPath({
      scope: args.scope,
      cwd: args.cwd,
      homeDir: args.homeDir
    });
    if (runtime === "codex") {
      return [
        args.scope === "global"
          ? getDefaultCodexGlobalInstructionsPath(args.homeDir)
          : getLocalTargetLabel("codex", args.cwd),
        sharedGuidePath,
        args.scope === "global"
          ? path.join(args.homeDir ?? os.homedir(), ".codex", "skills", "sift", "SKILL.md")
          : path.join(args.cwd ?? process.cwd(), ".codex", "skills", "sift", "SKILL.md")
      ];
    }

    if (runtime === "cursor") {
      return [
        sharedGuidePath,
        args.scope === "global"
          ? getDefaultCursorGlobalSkillPath(args.homeDir)
          : getLocalTargetLabel("cursor", args.cwd)
      ];
    }

    return [
      sharedGuidePath,
      args.scope === "global"
        ? getDefaultClaudeGlobalInstructionsPath(args.homeDir)
        : getLocalTargetLabel("claude", args.cwd),
      ...CLAUDE_COMMAND_NAMES.map((name) =>
        args.scope === "global"
          ? path.join(getDefaultClaudeGlobalCommandsDir(args.homeDir), `${name}.md`)
          : path.join(args.cwd ?? process.cwd(), ".claude", "commands", "sift", `${name}.md`)
      )
    ];
  });

  args.io.write(`\n${ui.section("Install preflight")}\n`);
  args.io.write(`${ui.note(`Will write guidance files for ${runtimeTargets.map((target) => INSTALL_TITLES[target]).join(" + ")} in ${args.scope === "global" ? "machine-wide" : "repo"} scope:`)}\n`);
  for (const target of writeTargets) {
    args.io.write(`  ${ui.command(target)}\n`);
  }
  if (args.operationMode === "provider-assisted") {
    args.io.write(
      `${ui.note(`Provider config stays machine-wide at ${getDefaultGlobalConfigPath(args.homeDir)} unless you later create a repo-local sift.config.yaml.`)}\n`
    );
  }
  args.io.write(`${ui.note("Will not write shell rc files, PATH entries, git hooks, or arbitrary repo files.")}\n`);
  args.io.write(`${ui.note("Managed blocks update only inside sift markers. Generated skill/command files update only when sift can prove ownership.")}\n`);
  if (runtimeTargets.includes("cursor")) {
    args.io.write(
      `${ui.note("If a compatible Codex skill already exists in the same scope, sift refuses to install a duplicate native Cursor skill.")}\n`
    );
  }
}

export async function installRuntimeSupport(options: {
  runtime?: InstallRuntime;
  scope?: AgentScope;
  operationMode?: OperationMode;
  yes?: boolean;
  io?: InstallRuntimeIO;
  cwd?: string;
  homeDir?: string;
  version: string;
}): Promise<number> {
  const io = options.io ?? createInstallTerminalIO();
  type InstallStep = "runtime" | "mode" | "scope" | "provider";
  const runtimeIsCopilot = options.runtime === "copilot";

  const getPreviousEditableStep = (step: InstallStep): InstallStep | undefined => {
    if (step === "runtime") {
      return undefined;
    }

    if (step === "mode") {
      return options.runtime ? undefined : "runtime";
    }

    if (step === "scope") {
      if (!options.operationMode) {
        return "mode";
      }
      if (!options.runtime) {
        return "runtime";
      }
      return undefined;
    }

    if (step === "provider") {
      if (!options.scope) {
        return "scope";
      }
      if (!options.operationMode) {
        return "mode";
      }
      if (!options.runtime) {
        return "runtime";
      }
      return undefined;
    }

    return undefined;
  };

  try {
    if (runtimeIsCopilot && options.scope === "global") {
      io.error("sift install copilot is repo-only. Use `sift install copilot --scope local` or omit --scope.\n");
      return 1;
    }

    if ((!io.stdinIsTTY || !io.stdoutIsTTY) && (!options.runtime || (!runtimeIsCopilot && !options.scope) || !options.yes)) {
      io.error(
        "sift install is interactive and requires a TTY. For non-interactive use `sift install codex --scope global --yes` or `sift install copilot --yes`.\n"
      );
      return 1;
    }

    if (io.stdoutIsTTY) {
      io.write(`${renderInstallBanner(options.version)}\n`);
    }

    let runtime = options.runtime;
    let operationMode: OperationMode | undefined = options.operationMode;
    let scope: AgentScope | undefined = options.scope;
    let step: InstallStep | undefined;

    if (runtime === "copilot") {
      scope = "repo";
      operationMode ??= "agent-escalation";
    }

    if (!io.stdinIsTTY || !io.stdoutIsTTY) {
      runtime ??= options.runtime;
      operationMode ??= "agent-escalation";
      if (runtime === "copilot") {
        scope = "repo";
      }
      step = undefined;
    } else if (!runtime) {
      step = "runtime";
    } else if (runtime !== "copilot" && !operationMode) {
      step = "mode";
    } else if (runtime !== "copilot" && !scope) {
      step = "scope";
    } else if (runtime !== "copilot" && operationMode === "provider-assisted") {
      step = "provider";
    }

    while (step) {
      if (step === "runtime") {
        const runtimeChoice = await promptForRuntime(io);
        if (runtimeChoice === PROMPT_BACK) {
          io.write(`\n${createPresentation(io.stdoutIsTTY).note("Install canceled before we touched anything.")}\n`);
          return 0;
        }
        runtime = runtimeChoice;
        if (runtime === "copilot") {
          scope = "repo";
          operationMode ??= "agent-escalation";
          step = undefined;
          continue;
        }
        step = !operationMode ? "mode" : !scope ? "scope" : operationMode === "provider-assisted" ? "provider" : undefined;
        continue;
      }

      if (step === "mode") {
        const modeChoice = await promptForOperationMode(io);
        if (modeChoice === PROMPT_BACK) {
          const previous = getPreviousEditableStep("mode");
          if (!previous) {
            io.write(`\n${createPresentation(io.stdoutIsTTY).note("Install canceled before we touched anything.")}\n`);
            return 0;
          }
          step = previous;
          continue;
        }

        operationMode = modeChoice;
        step = !scope ? "scope" : operationMode === "provider-assisted" ? "provider" : undefined;
        continue;
      }

      if (step === "scope") {
        const scopeChoice = await promptForScope({
          io,
          runtime: runtime!,
          cwd: options.cwd,
          homeDir: options.homeDir
        });

        if (scopeChoice === PROMPT_BACK) {
          const previous = getPreviousEditableStep("scope");
          if (!previous) {
            io.write(`\n${createPresentation(io.stdoutIsTTY).note("Install canceled before we touched anything.")}\n`);
            return 0;
          }
          step = previous;
          continue;
        }

        scope = scopeChoice;
        writePreflightSummary({
          io,
          runtime: runtime!,
          scope,
          operationMode: operationMode!,
          cwd: options.cwd,
          homeDir: options.homeDir
        });
        step = operationMode === "provider-assisted" ? "provider" : undefined;
        continue;
      }

      if (step === "provider") {
        if (scope === "repo") {
          io.write(
            `\n${createPresentation(io.stdoutIsTTY).note("Local only applies to the runtime instructions in this repo. Provider fallback config is still machine-wide so sift can reuse it anywhere.")}\n`
          );
        }
        io.write(`\n${createPresentation(io.stdoutIsTTY).info("Next: provider setup. Press Esc at any step to go back.")}\n`);
        const setupStatus = await configSetup({
          io,
          env: process.env,
          embedded: true,
          forcedMode: "provider-assisted",
          targetPath: getDefaultGlobalConfigPath(options.homeDir)
        });

        if (setupStatus === CONFIG_SETUP_BACK) {
          const previous = getPreviousEditableStep("provider");
          if (!previous) {
            io.write(`\n${createPresentation(io.stdoutIsTTY).note("Install canceled before we touched anything.")}\n`);
            return 0;
          }
          step = previous;
          continue;
        }

        if (setupStatus !== 0) {
          return setupStatus;
        }

        step = undefined;
        continue;
      }
    }

    const nestedIo = createNestedInstallIO(io);

    if (runtime === "copilot") {
      const targetPath = getCopilotInstructionsTargetPath(options.cwd);
      const existingContent = readOptionalFile(targetPath);
      const ownership = inspectCopilotInstructionsOwnership(existingContent);

      if (ownership === "custom") {
        io.error(
          `Refusing to overwrite a custom copilot-instructions.md at ${targetPath}. Move it, remove it manually, or choose a different target path.\n`
        );
        return 1;
      }

      if (io.stdoutIsTTY) {
        writePreflightSummary({
          io,
          runtime,
          scope: "repo",
          operationMode: operationMode ?? "agent-escalation",
          cwd: options.cwd,
          homeDir: options.homeDir
        });
      }

      writeTextFileAtomic(targetPath, `${renderCopilotInstructions()}\n`);
      writeSuccessSummary({
        io,
        version: options.version,
        runtime,
        scope: "repo",
        operationMode: operationMode ?? "agent-escalation",
        cwd: options.cwd,
        homeDir: options.homeDir
      });
      return 0;
    }

    for (const runtimeTarget of getInstallTargets(runtime!)) {
      if (runtimeTarget === "copilot") {
        continue;
      }

      const status =
        runtimeTarget === "cursor"
          ? await installSkill({
              runtime: "cursor",
              scope: scope!,
              yes: true,
              io: nestedIo,
              operationMode: operationMode!,
              cwd: options.cwd,
              homeDir: options.homeDir
            })
          : await installAgent({
              agent: runtimeTarget,
              scope: scope!,
              yes: true,
              io: nestedIo,
              operationMode: operationMode!,
              cwd: options.cwd,
              homeDir: options.homeDir
            });
      if (status !== 0) {
        return status;
      }
    }

    writeSuccessSummary({
      io,
      version: options.version,
      runtime: runtime!,
      scope: scope!,
      operationMode: operationMode!,
      cwd: options.cwd,
      homeDir: options.homeDir
    });
    return 0;
  } finally {
    io.close?.();
  }
}
