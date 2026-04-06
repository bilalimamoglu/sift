import type { OperationMode } from "../types.js";
import { getCompactPayloadIntro, getCompactWorkflowLines } from "./shared.js";

export function renderManagedInstructionBody(
  mode: OperationMode,
  guideReference = "SIFT.md"
): string {
  return [...getCompactPayloadIntro(mode), ...getCompactWorkflowLines(guideReference)].join("\n");
}
