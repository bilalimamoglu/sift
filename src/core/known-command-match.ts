export interface KnownCommandMatchArgs {
  command?: string[];
  shellCommand?: string;
}

export interface KnownCommandMatchResult {
  matched: boolean;
  presetName?: string;
  reason: string;
  commandFamily: string;
}

function isBareCommandName(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return !/[\\/]/.test(value);
}

function shellStartsWith(pattern: RegExp, shellCommand: string): boolean {
  return pattern.test(shellCommand.trim());
}

function getFallbackCommandFamily(first: string | undefined): string {
  if (!first) {
    return "unknown";
  }

  return isBareCommandName(first) ? first : "path-prefixed";
}

export function getKnownCommandFamily(args: KnownCommandMatchArgs): string {
  if (Array.isArray(args.command) && args.command.length > 0) {
    const first = args.command[0];
    const second = args.command[1];
    const third = args.command[2];

    if (first === "python" && second === "-m" && third === "pytest") {
      return "python -m pytest";
    }

    if (
      (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") &&
      second === "audit"
    ) {
      return `${first} audit`;
    }

    if (first === "terraform" && second === "plan") {
      return "terraform plan";
    }

    if (first === "git" && second === "diff") {
      return "git diff";
    }

    return getFallbackCommandFamily(first);
  }

  const shellCommand = args.shellCommand?.trim();
  if (!shellCommand) {
    return "unknown";
  }

  if (shellStartsWith(/^python\s+-m\s+pytest(?:\s|$)/, shellCommand)) {
    return "python -m pytest";
  }

  if (shellStartsWith(/^(npm|pnpm|yarn|bun)\s+audit(?:\s|$)/, shellCommand)) {
    return `${shellCommand.split(/\s+/, 1)[0]!} audit`;
  }

  if (shellStartsWith(/^terraform\s+plan(?:\s|$)/, shellCommand)) {
    return "terraform plan";
  }

  if (shellStartsWith(/^git\s+diff(?:\s|$)/, shellCommand)) {
    return "git diff";
  }

  const first = shellCommand.split(/\s+/, 1)[0];
  return getFallbackCommandFamily(first);
}

function matchArgvCommand(command: string[]): KnownCommandMatchResult {
  const first = command[0];
  const second = command[1];
  const third = command[2];
  const commandFamily = getKnownCommandFamily({ command });

  if (!first) {
    return {
      matched: false,
      reason: "Missing command.",
      commandFamily
    };
  }

  if (!isBareCommandName(first)) {
    return {
      matched: false,
      reason: "Path-prefixed binaries stay out of the beta matcher.",
      commandFamily
    };
  }

  if (first === "sift") {
    return {
      matched: false,
      reason: "sift commands are never re-hooked.",
      commandFamily
    };
  }

  if (first === "python" && second === "-m" && third === "pytest") {
    return {
      matched: true,
      presetName: "test-status",
      reason: "Matched python -m pytest -> test-status.",
      commandFamily
    };
  }

  if (first === "pytest" || first === "vitest" || first === "jest") {
    return {
      matched: true,
      presetName: "test-status",
      reason: `Matched ${first} -> test-status.`,
      commandFamily
    };
  }

  if (first === "tsc") {
    return {
      matched: true,
      presetName: "typecheck-summary",
      reason: "Matched tsc -> typecheck-summary.",
      commandFamily
    };
  }

  if (first === "eslint" || first === "biome" || first === "ruff" || first === "flake8") {
    return {
      matched: true,
      presetName: "lint-failures",
      reason: `Matched ${first} -> lint-failures.`,
      commandFamily
    };
  }

  if (
    (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") &&
    second === "audit"
  ) {
    return {
      matched: true,
      presetName: "audit-critical",
      reason: `Matched ${first} audit -> audit-critical.`,
      commandFamily
    };
  }

  if (first === "terraform" && second === "plan") {
    return {
      matched: true,
      presetName: "infra-risk",
      reason: "Matched terraform plan -> infra-risk.",
      commandFamily
    };
  }

  if (first === "git" && second === "diff") {
    return {
      matched: true,
      presetName: "diff-summary",
      reason: "Matched git diff -> diff-summary.",
      commandFamily
    };
  }

  return {
    matched: false,
    reason: "No known preset matcher for this command.",
    commandFamily
  };
}

function matchShellCommand(shellCommand: string): KnownCommandMatchResult {
  const trimmed = shellCommand.trim();
  const commandFamily = getKnownCommandFamily({ shellCommand });

  if (trimmed.length === 0) {
    return {
      matched: false,
      reason: "Missing shell command.",
      commandFamily
    };
  }

  if (shellStartsWith(/^sift(?:\s|$)/, trimmed)) {
    return {
      matched: false,
      reason: "sift commands are never re-hooked.",
      commandFamily
    };
  }

  if (shellStartsWith(/^python\s+-m\s+pytest(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "test-status",
      reason: "Matched python -m pytest -> test-status.",
      commandFamily
    };
  }

  if (shellStartsWith(/^(pytest|vitest|jest)(?:\s|$)/, trimmed)) {
    const tool = trimmed.split(/\s+/, 1)[0]!;
    return {
      matched: true,
      presetName: "test-status",
      reason: `Matched ${tool} -> test-status.`,
      commandFamily
    };
  }

  if (shellStartsWith(/^tsc(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "typecheck-summary",
      reason: "Matched tsc -> typecheck-summary.",
      commandFamily
    };
  }

  if (shellStartsWith(/^(eslint|biome|ruff|flake8)(?:\s|$)/, trimmed)) {
    const tool = trimmed.split(/\s+/, 1)[0]!;
    return {
      matched: true,
      presetName: "lint-failures",
      reason: `Matched ${tool} -> lint-failures.`,
      commandFamily
    };
  }

  if (shellStartsWith(/^(npm|pnpm|yarn|bun)\s+audit(?:\s|$)/, trimmed)) {
    const tool = trimmed.split(/\s+/, 1)[0]!;
    return {
      matched: true,
      presetName: "audit-critical",
      reason: `Matched ${tool} audit -> audit-critical.`,
      commandFamily
    };
  }

  if (shellStartsWith(/^terraform\s+plan(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "infra-risk",
      reason: "Matched terraform plan -> infra-risk.",
      commandFamily
    };
  }

  if (shellStartsWith(/^git\s+diff(?:\s|$)/, trimmed)) {
    return {
      matched: true,
      presetName: "diff-summary",
      reason: "Matched git diff -> diff-summary.",
      commandFamily
    };
  }

  return {
    matched: false,
    reason: "No known preset matcher for this command.",
    commandFamily
  };
}

export function matchKnownCommand(args: KnownCommandMatchArgs): KnownCommandMatchResult {
  const hasArgvCommand = Array.isArray(args.command) && args.command.length > 0;
  const hasShellCommand =
    typeof args.shellCommand === "string" && args.shellCommand.trim().length > 0;

  if (hasArgvCommand === hasShellCommand) {
    throw new Error("Provide either --shell <command> or -- <program> [args...].");
  }

  if (hasArgvCommand) {
    return matchArgvCommand(args.command!);
  }

  return matchShellCommand(args.shellCommand!);
}
