# 0003 — Support portable and hermetic development lanes

Status: accepted

Evidence: user confirmation on 2026-08-21 and
[experiment 0002](../.experiments/0002-portable-development-boundary.md).

## Context

The hermetic Nix/devenv environment provides repository-wide parity but makes
ordinary TypeScript contributions depend on fleet-specific tooling. A
conventional environment can already exercise a substantial, coherent subset
of the repository without weakening those checks.

## Evidence and Argument

The clean-container experiment proved frozen installation, reference-aware
TypeScript, 271 stable core tests, Vite and Wrangler builds, and docs checking
using only the pinned JavaScript toolchain. Independent failures located a
clear boundary at browsers, Genie, Nix, Git history, release state, and
infrastructure tooling. A disposable bind-mounted Compose checkout reproduced
the portable loop as the non-root checkout owner.

## Options

| Option | Consequence |
| --- | --- |
| A. Portable and full lanes with Docker as the executable portable contract (chosen) | Finite measured capability set with explicit escalation |
| B. Keep devenv as the only supported environment | One tool closure, but Nix and composition admit every contribution |
| C. Expand Docker until it matches the full environment | Duplicates browsers, Nix, generators, release, and infrastructure tooling |
| D. Document host commands without an executable oracle | Least configuration, but no failure-capable drift check |

## Decision

Choose A. The root Dockerfile is the cold-start oracle and the root Compose
service is its bind-mounted interactive form. The full devenv/Nix lane remains
authoritative beyond the measured portable boundary.

## Consequences

- Ordinary TypeScript, stable core tests, representative Vite and Wrangler
  builds, and docs source checks do not require Nix or megarepo tooling.
- The portable promise remains finite; adding a capability requires clean-image
  evidence and extending the Docker gate.
- Browser downloads, generated-source tooling, wa-sqlite rebuilds, release
  state, and infrastructure remain single-owned by the full lane.
- Compose writes through an exclusively owned checkout and does not attempt to
  coordinate shared worktree state or application ports.
- Pull requests cannot drift the portable contract unnoticed because its
  stable CI context builds the canonical Dockerfile.
