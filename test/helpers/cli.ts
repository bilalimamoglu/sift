import fs from "node:fs";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const srcCli = path.join(root, "src", "cli.ts");
const distCli = path.join(root, "dist", "cli.js");
const ISOLATED_ENV_KEYS = [
  "SIFT_PROVIDER",
  "SIFT_MODEL",
  "SIFT_BASE_URL",
  "SIFT_TIMEOUT_MS",
  "SIFT_MAX_INPUT_CHARS",
  "SIFT_MAX_CAPTURE_CHARS",
  "SIFT_PROVIDER_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY"
] as const;

export interface RunCliOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  input?: string;
  useDist?: boolean;
  cwd?: string;
}

function createBaseChildEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env
  };

  for (const key of ISOLATED_ENV_KEYS) {
    delete env[key];
  }

  if (!overrides?.HOME) {
    env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "sift-test-home-"));
  }

  return {
    ...env,
    ...overrides
  };
}

export function runCli(options: RunCliOptions = {}) {
  const args = options.useDist
    ? [distCli, ...(options.args ?? [])]
    : ["--import", "tsx", srcCli, ...(options.args ?? [])];

  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? root,
    env: createBaseChildEnv(options.env),
    input: options.input,
    encoding: "utf8"
  });
}

export async function runCliAsync(options: RunCliOptions = {}) {
  const args = options.useDist
    ? [distCli, ...(options.args ?? [])]
    : ["--import", "tsx", srcCli, ...(options.args ?? [])];

  const child = spawn(process.execPath, args, {
    cwd: options.cwd ?? root,
    env: createBaseChildEnv(options.env),
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  if (options.input !== undefined) {
    child.stdin.write(options.input);
  }

  child.stdin.end();

  const result = await new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({
        status,
        signal,
        stdout,
        stderr
      });
    });
  });

  return result;
}

export function repoRoot(): string {
  return root;
}
