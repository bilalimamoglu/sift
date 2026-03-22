import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { showAgent } from "../src/commands/agent.js";
import { runDoctor } from "../src/commands/doctor.js";
import { defaultConfig } from "../src/config/defaults.js";
import {
  getDefaultExecPathLine,
  getDoctorNextStepLine,
  getExecVsHookDecisionLine,
  getHookBetaLine
} from "../src/content/adoption.js";
import { repoRoot, runSourceCli } from "./helpers/cli.js";

function captureStdout(run: () => void): string {
  let output = "";
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;

  try {
    run();
    return output;
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

describe("adoption contract", () => {
  it("keeps the shared exec-vs-hook contract aligned across code and docs surfaces", async () => {
    const root = repoRoot();
    const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
    const cliReference = await fs.readFile(path.join(root, "docs", "cli-reference.md"), "utf8");

    const doctorOutput = captureStdout(() => {
      expect(runDoctor(defaultConfig, null)).toBe(0);
    });

    let agentPreview = "";
    showAgent({
      agent: "codex",
      io: {
        stdoutIsTTY: false,
        write(message: string) {
          agentPreview += message;
        }
      }
    });

    const cliHelp = runSourceCli({
      args: ["--help"]
    });

    const hookHelp = runSourceCli({
      args: ["hook", "--help"]
    });

    expect(readme).toContain("If you are new, start here");
    expect(readme).toContain("use `sift exec` for the normal first pass");
    expect(readme).toContain("use `sift hook` only as an optional beta shortcut");
    expect(readme).not.toContain("sift hook run -- pytest -q");

    expect(cliReference).toContain("If you are new, ignore the lower-level surfaces for now");
    expect(cliReference).toContain("This is an optional shortcut, not the main workflow.");
    expect(cliReference).toContain("This is the default product path.");
    expect(cliReference).toContain("unknown commands run unchanged");

    expect(doctorOutput).toContain(getDefaultExecPathLine());
    expect(doctorOutput).toContain(getHookBetaLine());
    expect(doctorOutput).toContain(getExecVsHookDecisionLine());
    expect(doctorOutput).toContain(getDoctorNextStepLine());

    expect(agentPreview).toContain(getDefaultExecPathLine());
    expect(agentPreview).toContain(getHookBetaLine());
    expect(agentPreview).toContain(getExecVsHookDecisionLine());
    expect(agentPreview).toContain("sift hook match -- pytest -q");

    expect(cliHelp.status).toBe(0);
    expect(cliHelp.stdout).toContain(getDefaultExecPathLine());
    expect(cliHelp.stdout).toContain(getHookBetaLine());

    expect(hookHelp.status).toBe(0);
    expect(hookHelp.stdout).toContain(getHookBetaLine());
    expect(hookHelp.stdout).toContain("hook match -- pytest -q");
  });

  it("keeps exec ahead of hook on first-contact surfaces", async () => {
    const root = repoRoot();
    const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
    const cliReference = await fs.readFile(path.join(root, "docs", "cli-reference.md"), "utf8");
    const doctorOutput = captureStdout(() => {
      expect(runDoctor(defaultConfig, null)).toBe(0);
    });

    let agentPreview = "";
    showAgent({
      agent: "codex",
      io: {
        stdoutIsTTY: false,
        write(message: string) {
          agentPreview += message;
        }
      }
    });

    const cliHelp = runSourceCli({
      args: ["--help"]
    });

    const firstContactSurfaces = [readme, cliReference, doctorOutput, agentPreview, cliHelp.stdout];

    for (const surface of firstContactSurfaces) {
      const execIndex = surface.indexOf("sift exec");
      const hookIndex = surface.indexOf("sift hook");

      expect(execIndex).toBeGreaterThanOrEqual(0);
      expect(hookIndex).toBeGreaterThanOrEqual(0);
      expect(execIndex).toBeLessThan(hookIndex);
    }
  });
});
