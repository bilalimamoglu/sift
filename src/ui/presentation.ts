import pc from "picocolors";

function applyColor(enabled: boolean, formatter: (value: string) => string, value: string): string {
  return enabled ? formatter(value) : value;
}

export interface Presentation {
  readonly useColor: boolean;
  banner(version: string): string;
  welcome(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  info(text: string): string;
  note(text: string): string;
  section(text: string): string;
  labelValue(label: string, value: string): string;
  command(text: string): string;
}

export function createPresentation(useColor: boolean): Presentation {
  return {
    useColor,
    banner(version: string): string {
      const mark = [
        "   \\\\  //",
        "    \\\\//",
        "     ||",
        "     o"
      ]
        .map((line) => applyColor(useColor, pc.cyan, line))
        .join("\n");

      const title = applyColor(useColor, (value) => pc.bold(pc.white(value)), `sift/${version}`);
      const tagline = applyColor(useColor, pc.dim, "Trim the noise. Keep the signal.");

      return `${mark}\n\n${title}\n${tagline}`;
    },
    welcome(text: string): string {
      return useColor
        ? `${pc.bold(pc.cyan("Welcome to sift."))} ${text}`
        : `Welcome to sift. ${text}`;
    },
    success(text: string): string {
      return useColor ? `${pc.green("✓")} ${text}` : text;
    },
    warning(text: string): string {
      return useColor ? `${pc.yellow("!")} ${text}` : text;
    },
    error(text: string): string {
      return useColor ? `${pc.red("x")} ${text}` : text;
    },
    info(text: string): string {
      return useColor ? `${pc.cyan("•")} ${text}` : text;
    },
    note(text: string): string {
      return applyColor(useColor, pc.dim, text);
    },
    section(text: string): string {
      return applyColor(useColor, pc.bold, text);
    },
    labelValue(label: string, value: string): string {
      return `${applyColor(useColor, (entry) => pc.bold(pc.cyan(entry)), label)}: ${value}`;
    },
    command(text: string): string {
      return applyColor(useColor, pc.bold, text);
    }
  };
}
