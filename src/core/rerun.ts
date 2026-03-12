import type { Goal, OutputFormat, PromptPolicyName, SiftConfig } from "../types.js";
import { runExec } from "./exec.js";
import {
  getCachedRerunCommand,
  getRemainingPytestNodeIds,
  getRemainingPytestRerunCommand,
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
  remaining?: boolean;
  detail?: "standard" | "focused" | "verbose";
  showRaw?: boolean;
}

export async function runRerun(request: RerunRequest): Promise<number> {
  const state = readCachedTestStatusRun();

  if (!request.remaining) {
    return runExec({
      ...request,
      ...getCachedRerunCommand(state),
      cwd: state.cwd,
      diff: true,
      presetName: "test-status",
      detail: "standard",
      showRaw: false
    });
  }

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
    skipCacheWrite: true
  });
}
