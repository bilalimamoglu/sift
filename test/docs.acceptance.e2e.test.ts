import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, runDistCliAsync } from "./helpers/cli.js";
import { createFakeOpenAIServer } from "./helpers/fake-openai.js";

describe("README quick start e2e", () => {
  it("documents the mode-first setup story in tracked docs", async () => {
    const root = repoRoot();
    const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
    const cliReference = await fs.readFile(path.join(root, "docs", "cli-reference.md"), "utf8");

    expect(readme).toContain("agent-escalation");
    expect(readme).toContain("provider-assisted");
    expect(readme).toContain("local-only");
    expect(readme).toContain("gpt-5-nano");
    expect(readme).toContain("gpt-5.4-nano");
    expect(readme).toContain("sift hook match -- pytest -q");
    expect(readme).toContain("unknown commands pass through untouched");
    expect(readme).toContain("use `sift exec` for the normal first pass");
    expect(readme).toContain("What Sift Will Touch");
    expect(readme).toContain("narrow safety assist");
    expect(readme).toContain("extraRiskPatterns");
    expect(readme).toContain("sift gain");
    expect(readme).toContain("sift discover");
    expect(readme).toContain("local history only");
    expect(readme).toContain("metadata only");
    expect(readme).toContain("sift install cursor");
    expect(readme).toContain(".cursor/skills/sift/SKILL.md");
    expect(readme).not.toContain("sift hook run -- pytest -q");

    expect(cliReference).toContain("agent-escalation");
    expect(cliReference).toContain("provider-assisted");
    expect(cliReference).toContain("local-only");
    expect(cliReference).toContain("gpt-5-nano");
    expect(cliReference).toContain("gpt-5.4-nano");
    expect(cliReference).toContain("sift hook match -- pytest -q");
    expect(cliReference).toContain("unknown commands run unchanged");
    expect(cliReference).toContain("suspicious instruction-like log lines");
    expect(cliReference).toContain("extraRiskPatterns");
    expect(cliReference).toContain("sift gain");
    expect(cliReference).toContain("sift discover");
    expect(cliReference).toContain("metadata only, not raw logs");
    expect(cliReference).toContain("discover only speaks when local history is thick enough");
    expect(cliReference).toContain("sift install cursor");
    expect(cliReference).toContain("sift skill show cursor");
    expect(cliReference).toContain("duplicate native Cursor skill");
    expect(cliReference).toContain("This is the default product path.");
    expect(cliReference).toContain("This is an optional shortcut, not the main workflow.");
  });

  it("supports the documented quick-start commands", async () => {
    const server = await createFakeOpenAIServer((body, _index, request) => {
      const serializedBody = JSON.stringify(body);
      const payload = (() => {
        if (serializedBody.includes("what changed?")) {
          return "Changed one file.";
        }

        if (serializedBody.includes("typecheck-summary") && serializedBody.includes("npm run typecheck")) {
          return "No type errors.";
        }

        if (serializedBody.includes("typecheck-summary")) {
          return "- Typecheck failed\n- TS2322 repeats in src/app.ts";
        }

        if (serializedBody.includes("lint-failures")) {
          return "- Lint failed\n- no-explicit-any is the top repeated rule";
        }

        if (serializedBody.includes("audit-critical")) {
          return JSON.stringify({
            status: "ok",
            vulnerabilities: [],
            summary: "No high or critical vulnerabilities found in the provided input."
          });
        }

        return "- Tests passed";
      })();

      return {
        body: request.path.includes("/responses")
          ? {
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: payload
                    }
                  ]
                }
              ]
            }
          : {
              choices: [{ message: { content: payload } }]
            }
      };
    });

    try {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-docs-home-"));
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        SIFT_PROVIDER: "openai",
        SIFT_BASE_URL: server.baseUrl,
        OPENAI_API_KEY: "test-key",
        SIFT_MODEL: "test-model"
      };

      const commands = [
        {
          args: [
            "exec",
            "what changed?",
            "--",
            "node",
            "-e",
            "console.log('diff --git a/file b/file\\n+change')"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "test-status",
            "--",
            "node",
            "-e",
            "console.log('12 passed')"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "test-status",
            "--",
            "node",
            "-e",
            "console.error('FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token'); process.exit(1)"
          ]
        },
        {
          args: ["rerun"]
        },
        {
          args: ["escalate"]
        },
        {
          args: [
            "exec",
            "--preset",
            "typecheck-summary",
            "--",
            "node",
            "-e",
            "console.error('src/app.ts:1:1 - error TS2322: Type string is not assignable to type number')"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "typecheck-summary",
            "--shell",
            "npm run typecheck"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "lint-failures",
            "--",
            "node",
            "-e",
            "console.error('src/app.ts\\n  1:1  error  Unexpected any  @typescript-eslint/no-explicit-any')"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "audit-critical",
            "--",
            "node",
            "-e",
            "console.log('critical vuln')"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "infra-risk",
            "--",
            "node",
            "-e",
            "console.log('Plan: 2 to destroy')"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "audit-critical",
            "--fail-on",
            "--",
            "node",
            "-e",
            "console.log('lodash: critical vulnerability')"
          ]
        },
        {
          args: [
            "exec",
            "--preset",
            "infra-risk",
            "--fail-on",
            "--",
            "node",
            "-e",
            "console.log('Plan: 2 to destroy')"
          ]
        },
        {
          args: ["hook", "match", "--", "pytest", "-q"]
        },
        {
          args: ["hook", "run", "--shell", "npm audit --json"]
        },
        {
          args: [
            "hook",
            "run",
            "--",
            "node",
            "-e",
            "console.log('hello from raw pass through')"
          ]
        },
        {
          args: ["agent", "show", "codex"]
        },
        {
          args: ["agent", "show", "codex", "--raw"]
        },
        {
          args: ["agent", "install", "codex", "--dry-run"]
        },
        {
          args: ["agent", "install", "codex", "--dry-run", "--raw"]
        },
        {
          args: ["skill", "show", "codex"]
        },
        {
          args: ["skill", "show", "codex", "--raw"]
        },
        {
          args: ["skill", "show", "cursor"]
        },
        {
          args: ["gain"]
        },
        {
          args: ["discover"]
        }
      ];

      const expectedStatuses = [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const outputs: string[] = [];

      for (const [index, command] of commands.entries()) {
        const result = await runDistCliAsync({
          args: command.args,
          env
        });

        outputs.push(result.stdout.trim());

        expect(result.status).toBe(expectedStatuses[index]);
        expect(result.stderr).toBe("");
      }

      expect(outputs[0]).toContain("Changed one file.");
      expect(outputs[1]).toBeDefined();
      expect((outputs[1] as string).toLowerCase()).toContain("tests passed");
      expect(outputs[2]).toContain("Tests did not pass");
      expect(outputs[3]).toContain("Tests did not pass");
      expect(outputs[4]).toContain(
        "tests/unit/test_auth.py::test_refresh -> assertion failed: expected token"
      );
      expect(outputs[5]).toContain("Typecheck failed");
      expect(outputs[6]).toContain("No type errors.");
      expect(outputs[7]).toContain("Lint failed");
      expect(JSON.parse(outputs[8]!)).toEqual({
        status: "ok",
        vulnerabilities: [],
        summary: "No high or critical vulnerabilities found in the provided input."
      });
      expect(JSON.parse(outputs[9]!).verdict).toBe("fail");
      expect(JSON.parse(outputs[10]!).vulnerabilities).toHaveLength(1);
      expect(outputs[11]).toBeDefined();
      expect(JSON.parse(outputs[11] as string).verdict).toBe("fail");
      expect(outputs[12]).toContain("decision: matched");
      expect(outputs[12]).toContain("preset: test-status");
      expect(JSON.parse(outputs[13]!)).toEqual({
        status: "ok",
        vulnerabilities: [],
        summary: "No high or critical vulnerabilities found in the provided input."
      });
      expect(outputs[14]).toContain("hello from raw pass through");
      expect(outputs[15]).toContain("Codex instructions preview");
      expect(outputs[16]).toContain("<!-- sift:begin codex -->");
      expect(outputs[17]).toContain("Dry run:");
      expect(outputs[17]).toContain("Codex managed block");
      expect(outputs[18]).toContain("<!-- sift:begin codex -->");
      expect(outputs[19]).toContain("Codex skill preview");
      expect(outputs[20]).toContain("name: sift");
      expect(outputs[21]).toContain("Cursor skill preview");
      expect(outputs[22]).toContain("Sift gain");
      expect(outputs[22]).toContain("Meaningful runs:");
      expect(outputs[22]).toContain("Low-signal runs:");
      expect(outputs[22]).toContain("Notes: size/token savings above use meaningful runs only.");
      expect(outputs[23]).toMatch(/No strong discover hints|Sift discover/);
    } finally {
      await server.close();
    }
  });
});
