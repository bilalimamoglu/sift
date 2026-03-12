import type { RunRequest } from "../types.js";
import { analyzeTestStatus } from "./heuristics.js";
import { runSift } from "./run.js";
import {
  createCachedTestStatusRun,
  diffTestStatusRuns,
  diffTestStatusTargets
} from "./testStatusState.js";

const CLEAR_SCREEN_PATTERN = /\u001bc|\u001b\[2J(?:\u001b\[H)?/g;
const SUMMARY_BOUNDARY_PATTERN =
  /^={5,}.*(?:passed|failed|errors?|no tests ran|interrupted).*={5,}\s*$/i;

function normalizeWatchInput(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

function hasVisibleContent(input: string): boolean {
  return input.split("\n").some((line) => line.trim().length > 0);
}

function splitBySummaryBoundaries(input: string): string[] {
  const cycles: string[] = [];
  let current: string[] = [];

  for (const line of input.split("\n")) {
    current.push(line);
    if (SUMMARY_BOUNDARY_PATTERN.test(line.trim())) {
      const candidate = current.join("\n").trim();
      if (candidate.length > 0) {
        cycles.push(candidate);
      }
      current = [];
    }
  }

  const trailing = current.join("\n").trim();
  if (trailing.length > 0) {
    cycles.push(trailing);
  }

  return cycles;
}

export function splitWatchCycles(input: string): string[] {
  const normalized = normalizeWatchInput(input);
  const clearScreenChunks = normalized
    .split(CLEAR_SCREEN_PATTERN)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (clearScreenChunks.length > 1) {
    return clearScreenChunks;
  }

  const summaryChunks = splitBySummaryBoundaries(normalized);
  if (summaryChunks.length > 1) {
    return summaryChunks;
  }

  return hasVisibleContent(normalized) ? [normalized.trim()] : [];
}

export function looksLikeWatchStream(input: string): boolean {
  const normalized = normalizeWatchInput(input);
  if (/\u001bc|\u001b\[2J(?:\u001b\[H)?/.test(normalized)) {
    return splitWatchCycles(input).length > 1;
  }

  return (
    /(watch(?:ing)?|waiting for file changes|rerunning|re-running)/i.test(normalized) &&
    splitWatchCycles(input).length > 1
  );
}

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}

async function runGenericWatch(request: RunRequest, cycles: string[]): Promise<string> {
  const rendered: string[] = [];
  let previousSummary: string | null = null;

  for (const [index, cycle] of cycles.entries()) {
    const currentSummary = await runSift({
      ...request,
      stdin: cycle
    });

    if (index === 0) {
      rendered.push(`- Cycle 1\n${indentBlock(currentSummary)}`);
      previousSummary = currentSummary;
      continue;
    }

    const changeSummary = await runSift({
      ...request,
      goal: "summarize",
      format: "bullets",
      policyName: undefined,
      detail: undefined,
      outputContract: undefined,
      analysisContext: undefined,
      fallbackJson: undefined,
      question:
        "What changed since the previous cycle? Mention what resolved, what stayed, and the next best action.",
      stdin: [
        "Previous cycle summary:",
        previousSummary ?? "",
        "",
        "Current cycle summary:",
        currentSummary
      ].join("\n")
    });

    rendered.push(
      [`- Cycle ${index + 1}`, indentBlock(changeSummary), indentBlock(currentSummary)].join("\n")
    );
    previousSummary = currentSummary;
  }

  return rendered.join("\n\n");
}

async function runTestStatusWatch(request: RunRequest, cycles: string[]): Promise<string> {
  const rendered: string[] = [];
  const cyclePayloads: Array<{
    cycle: number;
    diagnosis: unknown;
    changes: string[];
  }> = [];
  let previousRun: ReturnType<typeof createCachedTestStatusRun> | null = null;

  for (const [index, cycle] of cycles.entries()) {
    const analysis = analyzeTestStatus(cycle);
    let currentRun = createCachedTestStatusRun({
      cwd: process.cwd(),
      commandKey: `watch:${request.question}`,
      commandPreview: `watch:${request.question}`,
      detail: request.detail ?? "standard",
      exitCode:
        analysis.failed > 0 || analysis.errors > 0 || analysis.collectionErrorCount
          ? 1
          : 0,
      rawOutput: cycle,
      originalChars: cycle.length,
      truncatedApplied: false,
      analysis
    });

    const targetDelta =
      previousRun === null
        ? null
        : diffTestStatusTargets({
            previous: previousRun,
            current: currentRun
          });
    const diffLines =
      previousRun === null
        ? []
        : diffTestStatusRuns({
            previous: previousRun,
            current: currentRun
          }).lines;

    const output = await runSift({
      ...request,
      stdin: cycle,
      testStatusContext: {
        resolvedTests: targetDelta?.resolved,
        remainingTests: targetDelta?.remaining ?? currentRun.pytest?.failingNodeIds
      }
    });

    if (request.goal === "diagnose" && request.format === "json") {
      cyclePayloads.push({
        cycle: index + 1,
        diagnosis: JSON.parse(output),
        changes: diffLines
      });
    } else {
      const block = [`- Cycle ${index + 1}`];
      if (diffLines.length > 0) {
        block.push(...diffLines.map((line) => `  ${line}`));
      }
      block.push(indentBlock(output));
      rendered.push(block.join("\n"));
    }

    previousRun = currentRun;
  }

  if (request.goal === "diagnose" && request.format === "json") {
    const lastDiagnosis = cyclePayloads.at(-1)?.diagnosis as
      | { status?: string; next_best_action?: unknown }
      | undefined;

    return JSON.stringify(
      {
        status: cyclePayloads.some(
          (payload) =>
            typeof payload.diagnosis === "object" &&
            payload.diagnosis !== null &&
            "status" in payload.diagnosis &&
            (payload.diagnosis as { status?: string }).status === "insufficient"
        )
          ? "insufficient"
          : "ok",
        cycles: cyclePayloads,
        next_best_action: lastDiagnosis?.next_best_action ?? null
      },
      null,
      2
    );
  }

  return rendered.join("\n\n");
}

export async function runWatch(request: RunRequest): Promise<string> {
  const cycles = splitWatchCycles(request.stdin);
  if (cycles.length <= 1) {
    return runSift(request);
  }

  if (request.goal === "diagnose" && request.format === "json" && request.policyName !== "test-status") {
    throw new Error(
      "`--goal diagnose --format json` is currently supported only for `test-status` watch flows."
    );
  }

  if (request.policyName === "test-status") {
    return runTestStatusWatch(request, cycles);
  }

  return runGenericWatch(request, cycles);
}
