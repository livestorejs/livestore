# 0001 — Separate shell readiness from source validation

Status: accepted (2026-07-27, user confirmation; benchmark evidence in
[experiment 0001](../.experiments/0001-worktree-setup-and-trace.md))

## Context

Entering the supported development shell prepares dependencies, regenerates
derived configuration, and historically ran a full TypeScript workspace build.
The build was a validation gate rather than a prerequisite for inspecting or
repairing the repository. It added a serial cold step and repeated work on warm
entry.

## Options

- **A. Dependency and generated-source readiness only (chosen).** Automatic
  setup runs `pnpm:install` and `genie:run`; TypeScript remains an explicit
  developer and CI gate. This preserves integrity checks while making the
  diagnostic environment available before source errors are fixed.
- **B. Keep the full TypeScript build in shell entry.** Strong eager
  validation, but delays every invalidated shell and conflates environment
  access with repository correctness.
- **C. Replace the build with a narrower automatic TypeScript task.** Lower
  cost than B, but still delays shell access and has no demonstrated readiness
  consumer.

## Decision

Choose A. Shell readiness stops at dependency and generated-source readiness.
`ts:build` and `ts:check` remain explicit developer and CI gates.

## Consequences

- `setup:strict` continues to exercise the full dependency and
  generated-source readiness graph.
- Source errors do not delay or block access to the diagnostic environment.
- Cold Nix/devenv evaluation and dependency status-probe costs remain measured
  follow-up work rather than implicit acceptance conditions for this patch.
