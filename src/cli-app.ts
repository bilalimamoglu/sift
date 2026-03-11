import { createRequire } from "node:module";
import { cac } from "cac";
import {
  configInit,
  configSetup,
  configShow,
  configValidate
} from "./commands/config.js";
import { runDoctor } from "./commands/doctor.js";
import { listPresets, showPreset } from "./commands/presets.js";
import { findConfigPath } from "./config/load.js";
import { resolveConfig } from "./config/resolve.js";
import { runExec } from "./core/exec.js";
import {
  assertSupportedFailOnFormat,
  assertSupportedFailOnPreset,
  evaluateGate
} from "./core/gate.js";
import { runSift } from "./core/run.js";
import { readStdin } from "./core/stdin.js";
import { getPreset } from "./prompts/presets.js";
import { createPresentation } from "./ui/presentation.js";
import type {
  DetailLevel,
  JsonResponseFormatMode,
  OutputFormat,
  PartialSiftConfig,
  SiftConfig
} from "./types.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export interface CliDeps {
  readonly configInit: typeof configInit;
  readonly configSetup: typeof configSetup;
  readonly configShow: typeof configShow;
  readonly configValidate: typeof configValidate;
  readonly runDoctor: typeof runDoctor;
  readonly listPresets: typeof listPresets;
  readonly showPreset: typeof showPreset;
  readonly resolveConfig: typeof resolveConfig;
  readonly findConfigPath: typeof findConfigPath;
  readonly runExec: typeof runExec;
  readonly assertSupportedFailOnFormat: typeof assertSupportedFailOnFormat;
  readonly assertSupportedFailOnPreset: typeof assertSupportedFailOnPreset;
  readonly evaluateGate: typeof evaluateGate;
  readonly readStdin: typeof readStdin;
  readonly runSift: typeof runSift;
  readonly getPreset: typeof getPreset;
}

const defaultCliDeps: CliDeps = {
  configInit,
  configSetup,
  configShow,
  configValidate,
  runDoctor,
  listPresets,
  showPreset,
  resolveConfig,
  findConfigPath,
  runExec,
  assertSupportedFailOnFormat,
  assertSupportedFailOnPreset,
  evaluateGate,
  readStdin,
  runSift,
  getPreset
};

export function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}

export function buildCliOverrides(options: Record<string, unknown>): PartialSiftConfig {
  const overrides: PartialSiftConfig = {};

  if (
    options.provider !== undefined ||
    options.model !== undefined ||
    options.baseUrl !== undefined ||
    options.apiKey !== undefined ||
    options.jsonResponseFormat !== undefined ||
    options.timeoutMs !== undefined
  ) {
    overrides.provider = {
      provider: options.provider as SiftConfig["provider"]["provider"] | undefined,
      model: options.model as string | undefined,
      baseUrl: options.baseUrl as string | undefined,
      apiKey: options.apiKey as string | undefined,
      jsonResponseFormat:
        options.jsonResponseFormat as JsonResponseFormatMode | undefined,
      timeoutMs: toNumber(options.timeoutMs)
    };
  }

  if (
    options.maxCaptureChars !== undefined ||
    options.maxInputChars !== undefined ||
    options.headChars !== undefined ||
    options.tailChars !== undefined ||
    options.redact !== undefined ||
    options.redactStrict !== undefined ||
    options.stripAnsi !== undefined
  ) {
    overrides.input = {
      maxCaptureChars: toNumber(options.maxCaptureChars),
      maxInputChars: toNumber(options.maxInputChars),
      headChars: toNumber(options.headChars),
      tailChars: toNumber(options.tailChars),
      redact: options.redact as boolean | undefined,
      redactStrict: options.redactStrict as boolean | undefined,
      stripAnsi: options.stripAnsi as boolean | undefined
    };
  }

  if (options.rawFallback !== undefined || options.verbose !== undefined) {
    overrides.runtime = {
      rawFallback: options.rawFallback as boolean | undefined,
      verbose: options.verbose as boolean | undefined
    };
  }

  return overrides;
}

function applySharedOptions(command: ReturnType<ReturnType<typeof cac>["command"]>) {
  return command
    .option("--provider <provider>", "Provider: openai | openai-compatible")
    .option("--model <model>", "Model name")
    .option("--base-url <url>", "Provider base URL")
    .option(
      "--api-key <key>",
      "Provider API key (or set OPENAI_API_KEY for provider=openai; use SIFT_PROVIDER_API_KEY or endpoint-native envs for openai-compatible)"
    )
    .option(
      "--json-response-format <mode>",
      "JSON response format mode: auto | on | off"
    )
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--format <format>", "brief | bullets | json | verdict")
    .option(
      "--detail <mode>",
      "Detail level for supported presets: standard | focused | verbose"
    )
    .option("--max-capture-chars <n>", "Maximum raw child output chars kept in memory")
    .option("--max-input-chars <n>", "Maximum input chars sent to the model")
    .option("--head-chars <n>", "Head chars to preserve during truncation")
    .option("--tail-chars <n>", "Tail chars to preserve during truncation")
    .option("--strip-ansi", "Force ANSI stripping")
    .option("--redact", "Enable standard redaction")
    .option("--redact-strict", "Enable strict redaction")
    .option("--raw-fallback", "Enable raw fallback text output")
    .option("--dry-run", "Show the reduced input and prompt without calling the provider")
    .option("--show-raw", "Print the captured raw input to stderr for debugging")
    .option(
      "--fail-on",
      "Fail with exit code 1 when a supported built-in preset produces a blocking result"
    )
    .option("--config <path>", "Path to config file")
    .option("--verbose", "Enable verbose stderr logging");
}

export function normalizeDetail(value: unknown): DetailLevel | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "standard" || value === "focused" || value === "verbose") {
    return value;
  }

  throw new Error("Invalid --detail value. Use standard, focused, or verbose.");
}

export function resolveDetail(args: {
  presetName?: string;
  options: Record<string, unknown>;
}): DetailLevel | undefined {
  const requested = normalizeDetail(args.options.detail);

  if (!requested) {
    return args.presetName === "test-status" ? "standard" : undefined;
  }

  if (args.presetName !== "test-status") {
    throw new Error("--detail is supported only with --preset test-status.");
  }

  return requested;
}

export function extractExecCommand(options: Record<string, unknown>): {
  command?: string[];
  shellCommand?: string;
} {
  const passthrough = Array.isArray(options["--"])
    ? options["--"].map((value) => String(value))
    : [];
  const shellCommand =
    typeof options.shell === "string" && options.shell.trim().length > 0
      ? options.shell
      : undefined;

  if (shellCommand && passthrough.length > 0) {
    throw new Error("Use either --shell <command> or -- <program> [args...], not both.");
  }

  if (!shellCommand && passthrough.length === 0) {
    throw new Error("Missing command to execute.");
  }

  return {
    command: passthrough.length > 0 ? passthrough : undefined,
    shellCommand
  };
}

export function cleanHelpSectionBody(
  body: string,
  escapedVersion: string
): string {
  return body.replace(
    new RegExp(`(^|\\n)sift/${escapedVersion}\\n\\n?`, "g"),
    "\n"
  );
}

export function createCliApp(args: {
  deps?: Partial<CliDeps>;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  version?: string;
} = {}) {
  const deps: CliDeps = {
    ...defaultCliDeps,
    ...args.deps
  };
  const env = args.env ?? process.env;
  const stdout = args.stdout ?? process.stdout;
  const stderr = args.stderr ?? process.stderr;
  const version = args.version ?? pkg.version;
  const cli = cac("sift");
  const ui = createPresentation(Boolean(stdout.isTTY));
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  async function executeRun(input: {
    question: string;
    format: OutputFormat;
    presetName?: string;
    detail?: DetailLevel;
    policyName?: SiftConfig["presets"][string]["policy"];
    outputContract?: string;
    fallbackJson?: unknown;
    options: Record<string, unknown>;
  }): Promise<void> {
    if (Boolean(input.options.failOn)) {
      deps.assertSupportedFailOnPreset(input.presetName);
      deps.assertSupportedFailOnFormat({
        presetName: input.presetName,
        format: input.format
      });
    }

    const config = deps.resolveConfig({
      configPath: input.options.config as string | undefined,
      env,
      cliOverrides: buildCliOverrides(input.options)
    });
    const stdin = await deps.readStdin();

    if (Boolean(input.options.showRaw) && stdin.length > 0) {
      stderr.write(stdin);
      if (!stdin.endsWith("\n")) {
        stderr.write("\n");
      }
    }

    const output = await deps.runSift({
      question: input.question,
      format: input.format,
      stdin,
      config,
      dryRun: Boolean(input.options.dryRun),
      showRaw: Boolean(input.options.showRaw),
      detail: input.detail,
      presetName: input.presetName,
      policyName: input.policyName,
      outputContract: input.outputContract,
      fallbackJson: input.fallbackJson
    });

    stdout.write(`${output}\n`);

    if (
      Boolean(input.options.failOn) &&
      !Boolean(input.options.dryRun) &&
      input.presetName &&
      deps.evaluateGate({
        presetName: input.presetName,
        output
      }).shouldFail
    ) {
      process.exitCode = 1;
    }
  }

  async function executeExec(input: {
    question: string;
    format: OutputFormat;
    presetName?: string;
    detail?: DetailLevel;
    policyName?: SiftConfig["presets"][string]["policy"];
    outputContract?: string;
    fallbackJson?: unknown;
    options: Record<string, unknown>;
  }): Promise<void> {
    if (Boolean(input.options.failOn)) {
      deps.assertSupportedFailOnPreset(input.presetName);
      deps.assertSupportedFailOnFormat({
        presetName: input.presetName,
        format: input.format
      });
    }

    const config = deps.resolveConfig({
      configPath: input.options.config as string | undefined,
      env,
      cliOverrides: buildCliOverrides(input.options)
    });
    const command = extractExecCommand(input.options);
    process.exitCode = await deps.runExec({
      question: input.question,
      format: input.format,
      config,
      dryRun: Boolean(input.options.dryRun),
      failOn: Boolean(input.options.failOn),
      showRaw: Boolean(input.options.showRaw),
      detail: input.detail,
      presetName: input.presetName,
      policyName: input.policyName,
      outputContract: input.outputContract,
      fallbackJson: input.fallbackJson,
      ...command
    });
  }

  applySharedOptions(
    cli.command("preset <name>", "Run a named preset against piped output")
  )
    .usage("preset <name> [options]")
    .example("preset test-status < test-output.txt")
    .action(async (name: string, options: Record<string, unknown>) => {
      const config = deps.resolveConfig({
        configPath: options.config as string | undefined,
        env,
        cliOverrides: buildCliOverrides(options)
      });
      const preset = deps.getPreset(config, name);

      await executeRun({
        question: preset.question,
        format: (options.format as OutputFormat | undefined) ?? preset.format,
        presetName: name,
        detail: resolveDetail({
          presetName: name,
          options
        }),
        policyName:
          (options.format as OutputFormat | undefined) === undefined ||
          (options.format as OutputFormat | undefined) === preset.format
            ? preset.policy
            : undefined,
        options,
        outputContract: preset.outputContract,
        fallbackJson: preset.fallbackJson
      });
    });

  applySharedOptions(
    cli
      .command("exec [question]", "Run a command and shrink its output for the model")
      .allowUnknownOptions()
  )
    .usage("exec [question] [options] -- <program> [args...]")
    .example('exec "what changed?" -- git diff')
    .example("exec --preset test-status -- pytest")
    .example('exec --preset infra-risk --shell "terraform plan"')
    .option("--shell <command>", "Execute a shell command string instead of argv mode")
    .option("--preset <name>", "Run a named preset in exec mode")
    .action(async (question: string | undefined, options: Record<string, unknown>) => {
      if (question === "preset") {
        throw new Error("Use 'sift exec --preset <name> -- <program> ...' instead.");
      }

      const presetName =
        typeof options.preset === "string" && options.preset.length > 0
          ? options.preset
          : undefined;

      if (presetName) {
        if (question) {
          throw new Error("Use either a freeform question or --preset <name>, not both.");
        }

        const preset = deps.getPreset(
          deps.resolveConfig({
            configPath: options.config as string | undefined,
            env,
            cliOverrides: buildCliOverrides(options)
          }),
          presetName
        );

        await executeExec({
          question: preset.question,
          format: (options.format as OutputFormat | undefined) ?? preset.format,
          presetName,
          detail: resolveDetail({
            presetName,
            options
          }),
          policyName:
            (options.format as OutputFormat | undefined) === undefined ||
            (options.format as OutputFormat | undefined) === preset.format
              ? preset.policy
              : undefined,
          options,
          outputContract: preset.outputContract,
          fallbackJson: preset.fallbackJson
        });
        return;
      }

      if (!question) {
        throw new Error("Missing question or preset.");
      }

      const format = (options.format as OutputFormat | undefined) ?? "brief";
      await executeExec({
        question,
        format,
        detail: resolveDetail({
          options
        }),
        options
      });
    });

  cli
    .command("config <action>", "Config commands: setup | init | show | validate")
    .usage("config <setup|init|show|validate> [options]")
    .example("config setup")
    .example("config setup --global")
    .example("config setup --path ~/.config/sift/config.yaml")
    .example("config init")
    .example("config init --global")
    .example("config show")
    .example("config validate --config ./sift.config.yaml")
    .option("--path <path>", "Target config path for init or setup")
    .option(
      "--global",
      "Use the machine-wide config path (~/.config/sift/config.yaml) for init or setup"
    )
    .option("--config <path>", "Path to config file")
    .option("--show-secrets", "Show secret values in config show")
    .action(async (action: string, options: Record<string, unknown>) => {
      if (action === "setup") {
        process.exitCode = await deps.configSetup({
          targetPath: options.path as string | undefined,
          global: Boolean(options.global)
        });
        return;
      }

      if (action === "init") {
        deps.configInit(options.path as string | undefined, Boolean(options.global));
        return;
      }

      if (action === "show") {
        deps.configShow(
          options.config as string | undefined,
          Boolean(options.showSecrets)
        );
        return;
      }

      if (action === "validate") {
        deps.configValidate(options.config as string | undefined);
        return;
      }

      throw new Error(`Unknown config action: ${action}`);
    });

  cli
    .command("doctor", "Check which config is active and whether local setup looks complete")
    .usage("doctor [options]")
    .option("--config <path>", "Path to config file")
    .action((options: Record<string, unknown>) => {
      const configPath = deps.findConfigPath(options.config as string | undefined);
      const config = deps.resolveConfig({
        configPath: options.config as string | undefined,
        env
      });

      process.exitCode = deps.runDoctor(config, configPath);
    });

  cli
    .command("presets <action> [name]", "Preset commands: list | show")
    .usage("presets <list|show> [name] [options]")
    .example("presets list")
    .example("presets show infra-risk")
    .option("--config <path>", "Path to config file")
    .option("--internal", "Show internal preset fields in presets show")
    .action((action: string, name: string | undefined, options: Record<string, unknown>) => {
      const config = deps.resolveConfig({
        configPath: options.config as string | undefined,
        env
      });

      if (action === "list") {
        deps.listPresets(config);
        return;
      }

      if (action === "show") {
        if (!name) {
          throw new Error("Missing preset name.");
        }

        deps.showPreset(config, name, Boolean(options.internal));
        return;
      }

      throw new Error(`Unknown presets action: ${action}`);
    });

  applySharedOptions(cli.command("[question]", "Ask a question about piped output")).action(
    async (question: string | undefined, options: Record<string, unknown>) => {
      if (!question) {
        throw new Error("Missing question.");
      }

      const format = (options.format as OutputFormat | undefined) ?? "brief";
      await executeRun({
        question,
        format,
        detail: resolveDetail({
          options
        }),
        options
      });
    }
  );

  cli.help((sections) => {
    const cleanedSections = sections.map((section) => ({
      ...section,
      body: cleanHelpSectionBody(section.body, escapedVersion)
    }));

    return [
      {
        body: `${ui.banner(version)}\n`
      },
      {
        title: ui.section("Quick start"),
        body: [
          `  ${ui.command("sift config setup")}`,
          `  ${ui.command("sift exec --preset test-status -- pytest")}`,
          `  ${ui.command("sift exec --preset test-status --show-raw -- pytest")}`,
          `  ${ui.command('sift exec "what changed?" -- git diff')}`
        ].join("\n")
      },
      ...cleanedSections
    ];
  });
  cli.version(version);

  return cli;
}

export async function runCli(args: {
  argv?: string[];
  deps?: Partial<CliDeps>;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  version?: string;
} = {}): Promise<void> {
  const cli = createCliApp(args);
  cli.parse(args.argv ?? process.argv, { run: false });
  await cli.runMatchedCommand();
}

export function handleCliError(
  error: unknown,
  stderr: NodeJS.WriteStream = process.stderr
): void {
  const message = error instanceof Error ? error.message : "Unexpected error.";

  if (stderr.isTTY) {
    stderr.write(`${createPresentation(true).error(message)}\n`);
  } else {
    stderr.write(`${message}\n`);
  }

  process.exitCode = 1;
}
