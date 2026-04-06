<!-- sift:begin claude -->
Use `sift` as the default local-first output guidance layer for long, noisy, non-interactive command output.

Default operating mode: Agent escalation.
Best when you already have an agent open. sift does the quick first pass, then the agent can read code, tests, or logs and keep going.
If sift is still not enough, that is the handoff point: log it, narrow the problem, and let the agent keep digging.

Use `sift exec` first for long, noisy, non-interactive output.
If exact raw output is required, skip `sift` and read the raw output directly.
For test failures, start with `sift exec --preset test-status -- <test command>`.
Read `SIFT.md` for the full workflow, rerun/escalate path, and diagnose JSON notes.
<!-- sift:end claude -->

For this repository, do not add Claude or Anthropic attribution to commits or PRs.
Do not add `Co-Authored-By: Claude <noreply@anthropic.com>` or `Generated with Claude Code`.
