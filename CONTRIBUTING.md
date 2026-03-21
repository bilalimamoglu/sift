# Contributing to sift

Thanks for taking a look at `sift`.

This repo is still intentionally small, so the contribution process is meant to stay lightweight:

- open an issue first for bigger changes, behavior changes, or new presets
- small docs fixes, typo fixes, and targeted test improvements can usually go straight to a PR
- keep changes narrow and explain the user-facing reason for the change

## Local setup

`sift` requires Node.js 20+.

```bash
git clone https://github.com/bilalimamoglu/sift.git
cd sift
npm install
npm run build
```

Useful commands while working:

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
```

## What makes a good contribution

Good contributions usually do one of these well:

- fix a real reduction bug or misleading CLI behavior
- improve docs around onboarding, cache behavior, pipe vs exec workflows, or provider setup
- add or tighten tests for public CLI contracts
- improve built-in heuristics without making output noisier or less predictable

## Before you open a PR

Please make sure:

- tests pass locally for the surface you changed
- typecheck passes if you touched TypeScript code
- docs are updated if a command, flag, or workflow changed
- examples stay accurate when user-visible output changes materially

If your change affects CLI behavior, include a short before/after note in the PR description.

## PR guidance

Small, focused PRs are much easier to review than broad refactors.

Helpful PR descriptions usually include:

- what changed
- why it matters to a user or agent workflow
- any output or docs that changed
- any follow-up work intentionally left out

## Scope notes

`sift` is opinionated on purpose. That means some ideas are better as docs or examples than as new configuration surface.

Before proposing a new flag, preset, or extension point, it helps to explain:

- the concrete command-output problem
- why the current built-ins are not enough
- what user-facing contract should stay stable afterward

## Security

Please do not open public issues for security vulnerabilities.

Use the private reporting flow described in [SECURITY.md](SECURITY.md).
