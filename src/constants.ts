import os from "node:os";
import path from "node:path";

export const DEFAULT_CONFIG_FILENAME = "sift.config.yaml";

export function getDefaultGlobalConfigPath(): string {
  return path.join(os.homedir(), ".config", "sift", "config.yaml");
}

export function getDefaultConfigSearchPaths(): string[] {
  return [
    path.resolve(process.cwd(), "sift.config.yaml"),
    path.resolve(process.cwd(), "sift.config.yml"),
    getDefaultGlobalConfigPath(),
    path.join(os.homedir(), ".config", "sift", "config.yml")
  ];
}

export const INSUFFICIENT_SIGNAL_TEXT = "Insufficient signal in the provided input.";

export const GENERIC_JSON_CONTRACT =
  '{"answer":string,"evidence":string[],"risks":string[]}';

export const CAPTURE_OMITTED_MARKER = "\n...[captured output omitted]...\n";
