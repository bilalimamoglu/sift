import { INSUFFICIENT_SIGNAL_TEXT } from "../constants.js";

export interface InsufficientHintInput {
  presetName?: string;
  originalLength: number;
  truncatedApplied: boolean;
  exitCode?: number;
  recognizedRunner?: "pytest" | "vitest" | "jest" | "unknown";
  inputText?: string;
}

export type EvidenceShape =
  | "prose-doc"
  | "grep-hits"
  | "path-list"
  | "diff-stat"
  | "structured-data"
  | "generic";

export function isInsufficientSignalOutput(output: string): boolean {
  const trimmed = output.trim();
  return (
    trimmed === INSUFFICIENT_SIGNAL_TEXT ||
    trimmed.startsWith(`${INSUFFICIENT_SIGNAL_TEXT}\nHint:`)
  );
}

function looksLikeStructuredData(text: string): boolean {
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return true;
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 12);

  if (lines.length < 2) {
    return false;
  }

  const keyValueLines = lines.filter((line) =>
    /^["']?[\w.-]+["']?\s*:\s*\S+/.test(line)
  );

  return keyValueLines.length >= Math.max(2, Math.ceil(lines.length / 2));
}

function looksLikePathList(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 3) {
    return false;
  }

  const pathLike = lines.filter((line) =>
    /^(?:\.{1,2}\/|\/)?[\w@.-]+(?:\/[\w@.-]+)+(?:\.[\w-]+)?$/.test(line)
  );

  return pathLike.length >= Math.ceil(lines.length * 0.7);
}

function looksLikeGrepHits(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return false;
  }

  const grepLike = lines.filter((line) =>
    /^(?:\.{1,2}\/|\/)?[^:\n]+\:\d+(?::\d+)?[: -]/.test(line)
  );

  return grepLike.length >= Math.ceil(lines.length * 0.5);
}

function looksLikeDiffStat(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return false;
  }

  const statLines = lines.filter((line) => /\|\s+\d+\s+[+!-]+/.test(line));
  return (
    statLines.length >= 1 &&
    lines.some((line) => /\d+\s+files?\s+changed/.test(line))
  );
}

function looksLikeProseDoc(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 3) {
    return false;
  }

  const markdownish = lines.filter((line) =>
    /^(#{1,6}\s+|[-*]\s+|\d+\.\s+|> )/.test(line)
  ).length;
  const sentenceLike = lines.filter((line) =>
    /[A-Za-z]/.test(line) &&
    !/[|{}[\]]/.test(line) &&
    line.split(/\s+/).length >= 5
  ).length;

  return markdownish + sentenceLike >= Math.ceil(lines.length * 0.6);
}

export function classifyEvidenceShape(text: string): EvidenceShape {
  if (looksLikeStructuredData(text)) {
    return "structured-data";
  }
  if (looksLikeDiffStat(text)) {
    return "diff-stat";
  }
  if (looksLikeGrepHits(text)) {
    return "grep-hits";
  }
  if (looksLikePathList(text)) {
    return "path-list";
  }
  if (looksLikeProseDoc(text)) {
    return "prose-doc";
  }
  return "generic";
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
    const evidenceShape = input.inputText
      ? classifyEvidenceShape(input.inputText)
      : "generic";

    switch (evidenceShape) {
      case "prose-doc":
        hint =
          "Hint: captured output looks like prose or markdown, so this reducer could not safely turn it into a repo summary. Read the document directly or narrow the question to specific sections.";
        break;
      case "grep-hits":
        hint =
          "Hint: captured output looks like code-search results. Use it as a map, inspect the referenced files next, or rerun with a narrower search.";
        break;
      case "path-list":
        hint =
          "Hint: captured output looks like a file/path listing. It is useful as a map, but too thin for a confident summary without opening candidate files.";
        break;
      case "diff-stat":
        hint =
          "Hint: captured output looks like diff-stat evidence. It shows change surface, but not enough semantic detail for a confident product or code summary on its own.";
        break;
      case "structured-data":
        hint =
          "Hint: captured output looks like structured config or JSON text. Read the relevant keys directly or narrow the question to specific fields.";
        break;
      case "generic":
      default:
        hint =
          "Hint: the captured output did not contain a clear answer for this preset.";
        break;
    }
  }

  const presetSuggestion =
    input.recognizedRunner &&
    input.recognizedRunner !== "unknown" &&
    input.presetName !== "test-status" &&
    classifyEvidenceShape(input.inputText ?? "") === "generic"
      ? `Hint: captured output looks like ${input.recognizedRunner} test output; try --preset test-status.`
      : null;

  return [INSUFFICIENT_SIGNAL_TEXT, hint, presetSuggestion]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
