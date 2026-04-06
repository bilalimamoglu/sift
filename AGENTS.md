<!-- sift:begin codex -->
Use `sift` as the default local-first output guidance layer for long, noisy, non-interactive command output.

Default operating mode: Provider-assisted.
Best when you want sift itself to take one more cheap swing at the problem before you fall back to an agent or raw logs. Built-in rules first, API-backed backup second.
If the first pass is still fuzzy, sift can ask the fallback model so you do not have to escalate every annoying edge case by hand.

Use `sift exec` first for long, noisy, non-interactive output.
If exact raw output is required, skip `sift` and read the raw output directly.
For test failures, start with `sift exec --preset test-status -- <test command>`.
Read `SIFT.md` for the full workflow, rerun/escalate path, and diagnose JSON notes.
<!-- sift:end codex -->
