import pc from "picocolors";
import type { Goal, OutputFormat, PromptPolicyName, SiftConfig } from "../types.js";
import { buildInsufficientSignalOutput, isInsufficientSignalOutput } from "./insufficient.js";
import { runSift } from "./run.js";
import {
  getNextEscalationDetail,
  readCachedTestStatusRun,
  writeCachedTestStatusRun,
  type CachedTestStatusRun
} from "./testStatusState.js";

export interface EscalateRequest {
  config: SiftConfig;
  question: string;
  format: OutputFormat;
  goal?: Goal;
  policyName?: PromptPolicyName;
  outputContract?: string;
  fallbackJson?: unknown;
  dryRun?: boolean;
  includeTestIds?: boolean;
  detail?: "focused" | "verbose";
  showRaw?: boolean;
  verbose?: boolean;
}

function resolveEscalationDetail(
  state: CachedTestStatusRun,
  requested?: EscalateRequest["detail"],
  showRaw = false
): "focused" | "verbose" {
  if (requested) {
    return requested;
  }

  const nextDetail = getNextEscalationDetail(state.detail);
  if (!nextDetail && showRaw && state.detail === "verbose") {
    return "verbose";
  }

  if (!nextDetail) {
    throw new Error(
      "Cached test-status run is already at verbose detail. Use `sift escalate --show-raw` or rerun the test command if you need more context."
    );
  }

  return nextDetail;
}

export async function runEscalate(request: EscalateRequest): Promise<number> {
  const state = readCachedTestStatusRun();
  const detail = resolveEscalationDetail(state, request.detail, request.showRaw);

  if (request.verbose) {
    process.stderr.write(
      `${pc.dim("sift")} escalate detail=${detail} cached_detail=${state.detail} command=${state.commandPreview}\n`
    );
  }

  if (request.showRaw && state.rawOutput.length > 0) {
    process.stderr.write(state.rawOutput);
    if (!state.rawOutput.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }

  let output = await runSift({
    question: request.question,
    format: request.format,
    goal: request.goal,
    stdin: state.rawOutput,
    config: request.config,
    dryRun: request.dryRun,
    includeTestIds: request.includeTestIds,
    detail,
    presetName: "test-status",
    policyName: request.policyName ?? "test-status",
    outputContract: request.outputContract,
    fallbackJson: request.fallbackJson,
    testStatusContext: {
      remainingSubsetAvailable:
        Boolean(state.pytest?.subsetCapable) && (state.pytest?.failingNodeIds.length ?? 0) > 0
    }
  });

  if (isInsufficientSignalOutput(output)) {
    output = buildInsufficientSignalOutput({
      presetName: "test-status",
      originalLength: state.capture.originalChars,
      truncatedApplied: state.capture.truncatedApplied,
      exitCode: state.exitCode
    });
  }

  process.stdout.write(`${output}\n`);

  try {
    writeCachedTestStatusRun({
      ...state,
      detail
    });
  } catch (error) {
    if (request.verbose) {
      const reason = error instanceof Error ? error.message : "unknown_error";
      process.stderr.write(`${pc.dim("sift")} cache_write=failed reason=${reason}\n`);
    }
  }

  return state.exitCode;
}
