import { INSUFFICIENT_SIGNAL_TEXT } from "../constants.js";

export interface InsufficientHintInput {
  presetName?: string;
  originalLength: number;
  truncatedApplied: boolean;
  exitCode?: number;
}

export function isInsufficientSignalOutput(output: string): boolean {
  const trimmed = output.trim();
  return (
    trimmed === INSUFFICIENT_SIGNAL_TEXT ||
    trimmed.startsWith(`${INSUFFICIENT_SIGNAL_TEXT}\nHint:`)
  );
}

export function buildInsufficientSignalOutput(
  input: InsufficientHintInput
): string {
  let hint: string;

  if (input.originalLength === 0) {
    hint = "Hint: no command output was captured.";
  } else if (input.truncatedApplied) {
    hint = "Hint: captured output was truncated before a clear summary was found.";
  } else if (input.presetName === "test-status" && input.exitCode === 0) {
    hint = "Hint: command succeeded, but no recognizable test summary was found.";
  } else if (
    input.presetName === "test-status" &&
    typeof input.exitCode === "number"
  ) {
    hint =
      "Hint: command failed, but the captured output did not include a recognizable test summary.";
  } else {
    hint = "Hint: the captured output did not contain a clear answer for this preset.";
  }

  return `${INSUFFICIENT_SIGNAL_TEXT}\n${hint}`;
}
