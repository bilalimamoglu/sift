export function getDefaultExecPathLine(): string {
  return "Default path: use `sift exec` when you want the first useful diagnosis on a noisy command.";
}

export function getHookBetaLine(): string {
  return "Optional beta shortcut: use `sift hook` only for a tiny known-command set when you want less typing, and keep in mind that unknown commands stay raw.";
}

export function getExecVsHookDecisionLine(): string {
  return "`sift exec` is the explicit full-control path; `sift hook` is only a known-preset convenience wrapper.";
}

export function getDoctorNextStepLine(): string {
  return "Next step: run `sift exec --preset test-status -- <test command>` for the normal first pass. Optional beta: inspect `sift hook match -- <command>` if you want a known-preset shortcut.";
}

export function getInstallExplainLine(): string {
  return "You already installed sift with npm. This step writes runtime instructions for Codex or Claude and helps you choose how sift should behave.";
}

export function getHookBetaPlainEnglishLine(): string {
  return "Experimental shortcut: if sift recognizes the command, it picks a preset for you. If not, it just runs the original command.";
}
