import type { SiftConfig } from "../types.js";
import {
  clearHistory,
  readHistoryEvents,
  renderGainReport,
  summarizeHistory
} from "../core/history.js";

export interface GainArgs {
  config: SiftConfig;
  days?: number;
  byPreset?: boolean;
  clear?: boolean;
  yes?: boolean;
}

export async function runGain(args: GainArgs): Promise<number> {
  if (args.clear) {
    if (!args.yes && (!process.stdin.isTTY || !process.stdout.isTTY)) {
      throw new Error("sift gain clear requires --yes in non-interactive mode.");
    }

    if (!args.yes) {
      process.stdout.write("Clear local sift history? [y/N]: ");
      const accepted = await new Promise<boolean>((resolve) => {
        process.stdin.once("data", (chunk) => {
          const answer = chunk.toString("utf8").trim().toLowerCase();
          resolve(answer === "y" || answer === "yes");
        });
      });

      if (!accepted) {
        process.stdout.write("Left local sift history untouched.\n");
        return 0;
      }
    }

    await clearHistory({
      homeDir: process.env.HOME
    });
    process.stdout.write("Cleared local sift history.\n");
    return 0;
  }

  const events = await readHistoryEvents({
    homeDir: process.env.HOME,
    days: args.days
  });
  const summary = summarizeHistory(events);
  process.stdout.write(
    `${renderGainReport({
      summary,
      events,
      days: args.days,
      byPreset: Boolean(args.byPreset)
    })}\n`
  );
  return 0;
}
