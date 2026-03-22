import { buildDiscoverHints, readHistoryEvents, renderDiscoverReport } from "../core/history.js";

export interface DiscoverArgs {
  days?: number;
}

export async function runDiscover(args: DiscoverArgs = {}): Promise<number> {
  const events = await readHistoryEvents({
    homeDir: process.env.HOME,
    days: args.days
  });
  const hints = buildDiscoverHints(events);
  process.stdout.write(
    `${renderDiscoverReport({
      events,
      hints,
      days: args.days
    })}\n`
  );
  return 0;
}
