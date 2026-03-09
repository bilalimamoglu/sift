export interface TruncateOptions {
  maxInputChars: number;
  headChars: number;
  tailChars: number;
}

const SIGNAL_PATTERN =
  /(error|fail|failed|exception|panic|fatal|critical|denied|timeout|traceback)/i;
const OMITTED_MARKER = "\n...[middle content omitted]...\n";
const SIGNAL_MARKER = "\n...[selected signal lines]...\n";

function collectSignalLines(input: string): string[] {
  const deduped = new Set<string>();

  for (const line of input.split("\n")) {
    if (SIGNAL_PATTERN.test(line)) {
      deduped.add(line.trimEnd());
    }
  }

  return [...deduped].slice(0, 120);
}

export function truncateInput(
  input: string,
  options: TruncateOptions
): { text: string; truncatedApplied: boolean } {
  if (input.length <= options.maxInputChars) {
    return { text: input, truncatedApplied: false };
  }

  let headLength = Math.min(options.headChars, input.length, options.maxInputChars);
  let tailLength = Math.min(options.tailChars, input.length - headLength, options.maxInputChars);
  const signalLines = collectSignalLines(input).join("\n");

  while (headLength + tailLength + OMITTED_MARKER.length > options.maxInputChars) {
    if (headLength >= tailLength && headLength > 0) {
      headLength = Math.max(0, headLength - 250);
    } else if (tailLength > 0) {
      tailLength = Math.max(0, tailLength - 250);
    } else {
      break;
    }
  }

  const head = input.slice(0, headLength);
  const tail = input.slice(input.length - tailLength);
  const signalBudget =
    options.maxInputChars -
    head.length -
    tail.length -
    OMITTED_MARKER.length -
    (signalLines ? SIGNAL_MARKER.length : 0);

  const signalSnippet =
    signalBudget > 0 && signalLines
      ? signalLines.slice(0, signalBudget)
      : "";

  const text = [head, OMITTED_MARKER, signalSnippet ? `${SIGNAL_MARKER}${signalSnippet}` : "", tail]
    .join("")
    .slice(0, options.maxInputChars);

  return {
    text,
    truncatedApplied: true
  };
}
