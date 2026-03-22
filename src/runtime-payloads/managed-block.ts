import type { OperationMode } from "../types.js";
import { getSharedPayloadIntro, getSharedWorkflowLines } from "./shared.js";

export function renderManagedInstructionBody(mode: OperationMode): string {
  return [...getSharedPayloadIntro(mode), ...getSharedWorkflowLines()].join("\n");
}
