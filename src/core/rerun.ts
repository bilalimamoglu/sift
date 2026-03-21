import type {
  Goal,
  OutputFormat,
  PromptPolicyName,
  SiftConfig,
  TestStatusRemainingMode
} from "../types.js";
import { getScopedTestStatusStatePath } from "../constants.js";
import { runExec } from "./exec.js";
import {
  getCachedRerunCommand,
  getRemainingPytestNodeIds,
  getRemainingPytestRerunCommand,
  isRemainingSubsetAvailable,
  readCachedTestStatusRun
} from "./testStatusState.js";

export interface RerunRequest {
  config: SiftConfig;
  question: string;
  format: OutputFormat;
  goal?: Goal;
  policyName?: PromptPolicyName;
  outputContract?: string;
  fallbackJson?: unknown;
  dryRun?: boolean;
  includeTestIds?: boolean;
  remaining?: boolean;
  detail?: "standard" | "focused" | "verbose";
  showRaw?: boolean;
  testStatusContext?: {
    resolvedTests?: string[];
    remainingTests?: string[];
    remainingSubsetAvailable?: boolean;
    remainingMode?: TestStatusRemainingMode;
  };
}

export async function runRerun(request: RerunRequest): Promise<number> {
  const state = readCachedTestStatusRun(getScopedTestStatusStatePath(process.cwd()));

  if (!request.remaining) {
    return runExec({
      ...request,
      ...getCachedRerunCommand(state),
      cwd: state.cwd,
      diff: true,
      presetName: "test-status",
      detail: "standard",
      showRaw: false,
      readCachedBaseline: true,
      writeCachedBaseline: true,
      testStatusContext: {
        ...request.testStatusContext,
        remainingMode: "none"
      }
    });
  }

  if (state.runner.name === "pytest") {
    const remainingNodeIds = getRemainingPytestNodeIds(state);
    if (remainingNodeIds.length === 0) {
      process.stdout.write("No remaining failing pytest targets.\n");
      return 0;
    }

    return runExec({
      ...request,
      command: getRemainingPytestRerunCommand(state),
      cwd: state.cwd,
      diff: false,
      presetName: "test-status",
      readCachedBaseline: true,
      writeCachedBaseline: false,
      testStatusContext: {
        ...request.testStatusContext,
        remainingSubsetAvailable: isRemainingSubsetAvailable(state),
        remainingMode: "subset_rerun"
      }
    });
  }

  if (state.runner.name === "vitest" || state.runner.name === "jest") {
    if (!state.runner.baselineCommand || state.runnerMigrationFallbackUsed) {
      throw new Error(
        "Cached test-status run cannot use `sift rerun --remaining` yet because the original full command is unavailable from cache. Refresh the baseline with `sift exec --preset test-status -- <test command>` and retry."
      );
    }

    return runExec({
      ...request,
      ...getCachedRerunCommand(state),
      cwd: state.cwd,
      diff: false,
      presetName: "test-status",
      readCachedBaseline: true,
      writeCachedBaseline: false,
      testStatusContext: {
        ...request.testStatusContext,
        remainingSubsetAvailable: false,
        remainingMode: "full_rerun_diff"
      }
    });
  }

  throw new Error(
    "Cached test-status run cannot use `sift rerun --remaining` for this runner. Refresh with `sift exec --preset test-status -- <test command>` or rerun a narrowed command manually."
  );
}
