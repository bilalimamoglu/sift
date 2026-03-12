import pc from "picocolors";
import { applyHeuristicPolicy } from "./heuristics.js";
import { buildInsufficientSignalOutput, isInsufficientSignalOutput } from "./insufficient.js";
import {
  getNextEscalationDetail,
  readCachedTestStatusRun,
  writeCachedTestStatusRun,
  type CachedTestStatusRun
} from "./testStatusState.js";

export interface EscalateRequest {
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

export async function runEscalate(request: EscalateRequest = {}): Promise<number> {
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

  let output =
    applyHeuristicPolicy("test-status", state.rawOutput, detail) ??
    buildInsufficientSignalOutput({
      presetName: "test-status",
      originalLength: state.capture.originalChars,
      truncatedApplied: state.capture.truncatedApplied,
      exitCode: state.exitCode
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
