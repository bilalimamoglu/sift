import pc from "picocolors";

export interface RunStats {
  layer: "heuristic" | "provider" | "fallback";
  providerCalled: boolean;
  totalTokens: number | null;
  durationMs: number;
  presetName?: string;
}

export interface RunResult {
  output: string;
  stats: RunStats | null;
}

function formatDuration(durationMs: number): string {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
}

export function formatStatsFooter(stats: RunStats): string {
  const duration = formatDuration(stats.durationMs);

  if (stats.layer === "heuristic") {
    return `[sift: heuristic • LLM skipped • summary ${duration}]`;
  }

  if (stats.layer === "provider") {
    const tokenSegment = stats.totalTokens !== null ? ` • ${stats.totalTokens} tokens` : "";
    return `[sift: provider • LLM used${tokenSegment} • summary ${duration}]`;
  }

  return `[sift: fallback • provider failed • summary ${duration}]`;
}

export function emitStatsFooter(args: { stats: RunStats | null; quiet?: boolean }): void {
  if (args.quiet || !args.stats || !process.stderr.isTTY) {
    return;
  }

  process.stderr.write(`${pc.dim(formatStatsFooter(args.stats))}\n`);
}
