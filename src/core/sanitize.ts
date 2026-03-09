import stripAnsi from "strip-ansi";

export function sanitizeInput(input: string, stripAnsiEnabled: boolean): string {
  let output = input;

  if (stripAnsiEnabled) {
    output = stripAnsi(output);
  }

  return output
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
