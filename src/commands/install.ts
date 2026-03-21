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
  getDefaultClaudeGlobalInstructionsPath,
  getDefaultCodexGlobalInstructionsPath
} from "../constants.js";
import { createPresentation } from "../ui/presentation.js";
import { promptSelect } from "../ui/terminal.js";
import {
  installAgent,
  type AgentCommandIO,
  type AgentName,
  type AgentScope
} from "./agent.js";

export type InstallRuntime = AgentName | "all";

export interface InstallRuntimeIO extends AgentCommandIO {
  select?(prompt: string, options: string[], selectedLabel?: string): Promise<string>;
}

interface MenuChoice<T> {
  readonly label: string;
  readonly value: T;
}

const INSTALL_TITLES: Record<AgentName, string> = {
  codex: "Codex",
  claude: "Claude"
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

  async function select(prompt: string, options: string[], selectedLabel?: string): Promise<string> {
    emitKeypressEvents(defaultStdin);
    return await promptSelect({
      input: defaultStdin,
      output: defaultStdout,
      prompt,
      options,
      selectedLabel
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

  if (value === "codex" || value === "claude" || value === "all") {
    return value;
  }

  throw new Error("Invalid runtime. Use codex, claude, or all.");
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
  return [
    "  ███████╗██╗███████╗████████╗",
    "  ██╔════╝██║██╔════╝╚══██╔══╝",
    "  ███████╗██║█████╗     ██║   ",
    "  ╚════██║██║██╔══╝     ██║   ",
    "  ███████║██║██║        ██║   ",
    "  ╚══════╝╚═╝╚═╝        ╚═╝   ",
    "",
    `  sift v${version}`,
    "  Trim the noise. Keep the signal.",
    "  Local-first output guidance for your coding runtime."
  ].join("\n");
}

function getInstallTargets(runtime: InstallRuntime): AgentName[] {
  if (runtime === "all") {
    return ["codex", "claude"];
  }

  return [runtime];
}

function getGlobalTargetLabel(agent: AgentName, homeDir = os.homedir()): string {
  return agent === "codex"
    ? getDefaultCodexGlobalInstructionsPath(homeDir)
    : getDefaultClaudeGlobalInstructionsPath(homeDir);
}

function getLocalTargetLabel(agent: AgentName, cwd = process.cwd()): string {
  return agent === "codex"
    ? path.join(cwd, "AGENTS.md")
    : path.join(cwd, "CLAUDE.md");
}

function describeScopeChoice(args: {
  runtime: InstallRuntime;
  scope: AgentScope;
  cwd?: string;
  homeDir?: string;
}): string {
  const targets = getInstallTargets(args.runtime);
  const labels = targets.map((agent) =>
    args.scope === "global"
      ? getGlobalTargetLabel(agent, args.homeDir)
      : getLocalTargetLabel(agent, args.cwd)
  );

  return labels.join(" + ");
}

async function promptWithMenu<T>(args: {
  io: InstallRuntimeIO;
  prompt: string;
  choices: MenuChoice<T>[];
  defaultIndex?: number;
  selectedLabel: string;
}): Promise<T> {
  const defaultIndex = args.defaultIndex ?? 0;

  if (args.io.select) {
    const labels = args.choices.map((choice) => choice.label);
    const selected = await args.io.select(args.prompt, labels, args.selectedLabel);
    const match = args.choices.find((choice) => choice.label === selected);
    if (match) {
      return match.value;
    }
  }

  args.io.write(`\n${args.prompt}\n\n`);
  args.choices.forEach((choice, index) => {
    args.io.write(`  ${index + 1}) ${choice.label}\n`);
  });
  args.io.write("\n");

  while (true) {
    const answer = (await args.io.ask(`Choice [${defaultIndex + 1}]: `)).trim();
    if (answer === "") {
      return args.choices[defaultIndex]?.value ?? args.choices[0]!.value;
    }

    const choiceIndex = Number(answer);
    if (Number.isInteger(choiceIndex) && choiceIndex >= 1 && choiceIndex <= args.choices.length) {
      return args.choices[choiceIndex - 1]!.value;
    }

    args.io.error(`Please enter a number between 1 and ${args.choices.length}.\n`);
  }
}

async function promptForRuntime(io: InstallRuntimeIO): Promise<InstallRuntime> {
  return await promptWithMenu({
    io,
    prompt: "Which runtime(s) would you like to install for?",
    selectedLabel: "Runtime",
    choices: [
      {
        label: "Codex   (AGENTS.md / ~/.codex/AGENTS.md)",
        value: "codex"
      },
      {
        label: "Claude  (CLAUDE.md / ~/.claude/CLAUDE.md)",
        value: "claude"
      },
      {
        label: "All",
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
}): Promise<AgentScope> {
  return await promptWithMenu({
    io: args.io,
    prompt: "Where would you like to install?",
    selectedLabel: "Location",
    choices: [
      {
        label: `Global (${describeScopeChoice({
          runtime: args.runtime,
          scope: "global",
          cwd: args.cwd,
          homeDir: args.homeDir
        })}) - available in all projects`,
        value: "global"
      },
      {
        label: `Local  (${describeScopeChoice({
          runtime: args.runtime,
          scope: "repo",
          cwd: args.cwd,
          homeDir: args.homeDir
        })}) - this project only`,
        value: "repo"
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
  cwd?: string;
  homeDir?: string;
}): void {
  const ui = createPresentation(args.io.stdoutIsTTY);
  const targets = getInstallTargets(args.runtime);
  const scopeLabel = args.scope === "global" ? "global" : "local";
  const targetLabel = describeScopeChoice({
    runtime: args.runtime,
    scope: args.scope,
    cwd: args.cwd,
    homeDir: args.homeDir
  });

  if (args.io.stdoutIsTTY) {
    args.io.write(`\n${ui.success("Installed runtime support.")}\n`);
  } else {
    args.io.write("Installed runtime support.\n");
  }

  args.io.write(
    `${ui.note(`sift v${args.version} now manages ${targets.map((target) => INSTALL_TITLES[target]).join(" + ")} in ${scopeLabel} scope.`)}\n`
  );
  args.io.write(`${ui.note("Local-first output guidance is now available in your coding workflow.")}\n`);
  args.io.write(`${ui.note(targetLabel)}\n`);
  args.io.write(`\n${ui.section("Try next")}\n`);
  args.io.write(`  ${ui.command("sift doctor")}\n`);
  args.io.write(`  ${ui.command("sift config setup")}\n`);
  args.io.write(`  ${ui.command("sift exec --preset test-status -- npm test")}\n`);
  args.io.write(
    `${ui.note("Advanced previews and raw block output are still available under `sift agent install ...`.")}\n`
  );
}

export async function installRuntimeSupport(options: {
  runtime?: InstallRuntime;
  scope?: AgentScope;
  yes?: boolean;
  io?: InstallRuntimeIO;
  cwd?: string;
  homeDir?: string;
  version: string;
}): Promise<number> {
  const io = options.io ?? createInstallTerminalIO();

  try {
    if ((!io.stdinIsTTY || !io.stdoutIsTTY) && (!options.runtime || !options.scope || !options.yes)) {
      io.error(
        "sift install is interactive and requires a TTY. For non-interactive use `sift install codex --scope global --yes`.\n"
      );
      return 1;
    }

    if (io.stdoutIsTTY) {
      io.write(`${renderInstallBanner(options.version)}\n`);
    }

    const runtime = options.runtime ?? (await promptForRuntime(io));
    const scope =
      options.scope ??
      (await promptForScope({
        io,
        runtime,
        cwd: options.cwd,
        homeDir: options.homeDir
      }));
    const nestedIo = createNestedInstallIO(io);

    for (const agent of getInstallTargets(runtime)) {
      const status = await installAgent({
        agent,
        scope,
        yes: true,
        io: nestedIo,
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
      runtime,
      scope,
      cwd: options.cwd,
      homeDir: options.homeDir
    });
    return 0;
  } finally {
    io.close?.();
  }
}
