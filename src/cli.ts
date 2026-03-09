#!/usr/bin/env node
import { createRequire } from "node:module";
import { cac } from "cac";
import { configInit, configShow, configValidate } from "./commands/config.js";
import { runDoctor } from "./commands/doctor.js";
import { listPresets, showPreset } from "./commands/presets.js";
import { resolveConfig } from "./config/resolve.js";
import { runExec } from "./core/exec.js";
import { readStdin } from "./core/stdin.js";
import { runSift } from "./core/run.js";
import { getPreset } from "./prompts/presets.js";
import type {
  JsonResponseFormatMode,
  OutputFormat,
  PartialSiftConfig,
  SiftConfig
} from "./types.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
const cli = cac("sift");

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}

function buildCliOverrides(options: Record<string, unknown>): PartialSiftConfig {
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

function applySharedOptions(command: ReturnType<typeof cli.command>) {
  return command
    .option("--provider <provider>", "Provider: openai-compatible")
    .option("--model <model>", "Model name")
    .option("--base-url <url>", "Provider base URL")
    .option(
      "--api-key <key>",
      "Provider API key (or set SIFT_PROVIDER_API_KEY; OPENAI_API_KEY also works for api.openai.com)"
    )
    .option(
      "--json-response-format <mode>",
      "JSON response format mode: auto | on | off"
    )
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--format <format>", "brief | bullets | json | verdict")
    .option("--max-capture-chars <n>", "Maximum raw child output chars kept in memory")
    .option("--max-input-chars <n>", "Maximum input chars sent to the model")
    .option("--head-chars <n>", "Head chars to preserve during truncation")
    .option("--tail-chars <n>", "Tail chars to preserve during truncation")
    .option("--strip-ansi", "Force ANSI stripping")
    .option("--redact", "Enable standard redaction")
    .option("--redact-strict", "Enable strict redaction")
    .option("--raw-fallback", "Enable raw fallback text output")
    .option("--dry-run", "Show the reduced input and prompt without calling the provider")
    .option("--config <path>", "Path to config file")
    .option("--verbose", "Enable verbose stderr logging");
}

async function executeRun(args: {
  question: string;
  format: OutputFormat;
  policyName?: SiftConfig["presets"][string]["policy"];
  outputContract?: string;
  fallbackJson?: unknown;
  options: Record<string, unknown>;
}): Promise<void> {
  const config = resolveConfig({
    configPath: args.options.config as string | undefined,
    env: process.env,
    cliOverrides: buildCliOverrides(args.options)
  });
  const stdin = await readStdin();
  const output = await runSift({
    question: args.question,
    format: args.format,
    stdin,
    config,
    dryRun: Boolean(args.options.dryRun),
    policyName: args.policyName,
    outputContract: args.outputContract,
    fallbackJson: args.fallbackJson
  });

  process.stdout.write(`${output}\n`);
}

function extractExecCommand(options: Record<string, unknown>): {
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

async function executeExec(args: {
  question: string;
  format: OutputFormat;
  policyName?: SiftConfig["presets"][string]["policy"];
  outputContract?: string;
  fallbackJson?: unknown;
  options: Record<string, unknown>;
}): Promise<void> {
  const config = resolveConfig({
    configPath: args.options.config as string | undefined,
    env: process.env,
    cliOverrides: buildCliOverrides(args.options)
  });
  const command = extractExecCommand(args.options);
  process.exitCode = await runExec({
    question: args.question,
    format: args.format,
    config,
    dryRun: Boolean(args.options.dryRun),
    policyName: args.policyName,
    outputContract: args.outputContract,
    fallbackJson: args.fallbackJson,
    ...command
  });
}

applySharedOptions(
  cli.command("preset <name>", "Run a named preset against piped CLI output")
)
  .usage("preset <name> [options]")
  .example("preset test-status < test-output.txt")
  .action(async (name: string, options: Record<string, unknown>) => {
  const config = resolveConfig({
    configPath: options.config as string | undefined,
    env: process.env,
    cliOverrides: buildCliOverrides(options)
  });
  const preset = getPreset(config, name);

  await executeRun({
    question: preset.question,
    format: (options.format as OutputFormat | undefined) ?? preset.format,
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
    .command("exec [question]", "Run a command and reduce its output")
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

      const preset = getPreset(
        resolveConfig({
          configPath: options.config as string | undefined,
          env: process.env,
          cliOverrides: buildCliOverrides(options)
        }),
        presetName
      );

      await executeExec({
        question: preset.question,
        format: (options.format as OutputFormat | undefined) ?? preset.format,
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
      options
    });
  });

cli
  .command(
    "config <action>",
    "Config commands: init | show | validate (show/validate use resolved runtime config)"
  )
  .usage("config <init|show|validate> [options]")
  .example("config init")
  .example("config show")
  .example("config validate --config ./sift.config.yaml")
  .option("--path <path>", "Target config path for init")
  .option("--config <path>", "Path to config file")
  .option("--show-secrets", "Show secret values in config show")
  .action((action: string, options: Record<string, unknown>) => {
    if (action === "init") {
      configInit(options.path as string | undefined);
      return;
    }

    if (action === "show") {
      configShow(
        options.config as string | undefined,
        Boolean(options.showSecrets)
      );
      return;
    }

    if (action === "validate") {
      configValidate(options.config as string | undefined);
      return;
    }

    throw new Error(`Unknown config action: ${action}`);
  });

cli
  .command("doctor", "Check local runtime config completeness")
  .usage("doctor [options]")
  .option("--config <path>", "Path to config file")
  .action((options: Record<string, unknown>) => {
    const config = resolveConfig({
      configPath: options.config as string | undefined,
      env: process.env
    });

    process.exitCode = runDoctor(config);
  });

cli
  .command("presets <action> [name]", "Preset commands: list | show")
  .usage("presets <list|show> [name] [options]")
  .example("presets list")
  .example("presets show infra-risk")
  .option("--config <path>", "Path to config file")
  .option("--internal", "Show internal preset fields in presets show")
  .action((action: string, name: string | undefined, options: Record<string, unknown>) => {
    const config = resolveConfig({
      configPath: options.config as string | undefined,
      env: process.env
    });

    if (action === "list") {
      listPresets(config);
      return;
    }

    if (action === "show") {
      if (!name) {
        throw new Error("Missing preset name.");
      }

      showPreset(config, name, Boolean(options.internal));
      return;
    }

    throw new Error(`Unknown presets action: ${action}`);
  });

applySharedOptions(
  cli.command("[question]", "Ask a freeform question about piped CLI output")
).action(async (question: string | undefined, options: Record<string, unknown>) => {
  if (!question) {
    throw new Error("Missing question.");
  }

  const format = (options.format as OutputFormat | undefined) ?? "brief";
  await executeRun({
    question,
    format,
    options
  });
});

cli.help();
cli.version(pkg.version);

async function main(): Promise<void> {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
