import type { OperationMode } from "../types.js";

export function getOperationModeLabel(mode: OperationMode): string {
  switch (mode) {
    case "agent-escalation":
      return "Agent escalation";
    case "provider-assisted":
      return "Provider-assisted";
    case "local-only":
      return "Local-only";
  }
}

export function describeOperationMode(mode: OperationMode): string {
  switch (mode) {
    case "agent-escalation":
      return "Best when you already have an agent open. sift does the quick first pass, then the agent can read code, tests, or logs and keep going.";
    case "provider-assisted":
      return "Best when you want sift itself to take one more cheap swing at the problem before you fall back to an agent or raw logs. Built-in rules first, API-backed backup second.";
    case "local-only":
      return "Best when you are not pairing sift with another agent and do not want API keys. Everything stays local.";
  }
}

export function describeInsufficientBehavior(mode: OperationMode): string {
  switch (mode) {
    case "agent-escalation":
      return "If sift is still not enough, that is the handoff point: log it, narrow the problem, and let the agent keep digging.";
    case "provider-assisted":
      return "If the first pass is still fuzzy, sift can ask the fallback model so you do not have to escalate every annoying edge case by hand.";
    case "local-only":
      return "If sift is still not enough, stay local: rerun something narrower, use a better preset, or read the relevant source and tests yourself.";
  }
}
