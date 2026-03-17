import { afterEach, describe, expect, it, vi } from "vitest";
import { emitStatsFooter, formatStatsFooter, type RunStats } from "../src/core/stats.js";

describe("stats helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats heuristic, provider, and fallback footers", () => {
    expect(
      formatStatsFooter({
        layer: "heuristic",
        providerCalled: false,
        totalTokens: null,
        durationMs: 47
      })
    ).toBe("[sift: heuristic • LLM skipped • summary 47ms]");

    expect(
      formatStatsFooter({
        layer: "provider",
        providerCalled: true,
        totalTokens: 380,
        durationMs: 1200
      })
    ).toBe("[sift: provider • LLM used • 380 tokens • summary 1.2s]");

    expect(
      formatStatsFooter({
        layer: "provider",
        providerCalled: true,
        totalTokens: null,
        durationMs: 1200
      })
    ).toBe("[sift: provider • LLM used • summary 1.2s]");

    expect(
      formatStatsFooter({
        layer: "fallback",
        providerCalled: true,
        totalTokens: null,
        durationMs: 1200
      })
    ).toBe("[sift: fallback • provider failed • summary 1.2s]");
  });

  it("suppresses emission when quiet, non-tty, or stats are absent", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true
    });

    try {
      emitStatsFooter({
        stats: null,
        quiet: false
      });
      emitStatsFooter({
        stats: {
          layer: "heuristic",
          providerCalled: false,
          totalTokens: null,
          durationMs: 47
        },
        quiet: true
      });
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: false
      });
      emitStatsFooter({
        stats: {
          layer: "provider",
          providerCalled: true,
          totalTokens: 380,
          durationMs: 1200
        },
        quiet: false
      });
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
    }

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("emits the formatted footer on tty stderr", () => {
    let stderr = "";
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr += chunk.toString();
        return true;
      });
    const originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true
    });

    try {
      emitStatsFooter({
        stats: {
          layer: "heuristic",
          providerCalled: false,
          totalTokens: null,
          durationMs: 47,
          presetName: "typecheck-summary"
        } satisfies RunStats,
        quiet: false
      });
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
      stderrSpy.mockRestore();
    }

    expect(stderr).toContain("[sift: heuristic • LLM skipped • summary 47ms]");
  });
});
