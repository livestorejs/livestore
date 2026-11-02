# 0003 — Support Minimal Setup and Full Setup (Nix + devenv)

Status: accepted

Evidence: the 2026-08-20
[developer setup discussion](https://app.notion.com/p/schickling/3c2e3d41f4a380b58b07daa038191f3e)
and [experiment 0003](../.experiments/0003-portable-development-boundary.md).

## Context

The hermetic Nix/devenv environment provides repository-wide parity but makes
ordinary TypeScript contributions depend on fleet-specific tooling. A
Minimal Setup can already exercise a substantial, coherent subset
of the repository without weakening those checks.

The discussion identified a long first Nix setup and large download as a
material admission cost, especially when Nix feels unfamiliar or intrusive on
macOS. Its directional goal was to cover the TypeScript-heavy majority of
contributions through Minimal Setup while retaining Full Setup (Nix + devenv) as the holistic
dependency and final-validation authority. The stated proportion was an
estimate, not measured coverage.

## Evidence and Argument

The clean-container experiment proved frozen installation, reference-aware
TypeScript, 271 stable core tests, Vite and Wrangler builds, and docs checking
using only the pinned JavaScript toolchain. Independent failures located a
clear boundary at browsers, Genie, Nix, Git history, release state, and
infrastructure tooling. A disposable bind-mounted Compose checkout reproduced
the portable loop as the non-root checkout owner.

Committed SQLite distribution artifacts make ordinary use portable, while a
rebuild requires the full Nix/Emscripten closure. This supplies a principled
boundary instead of adding tools one failure at a time.

## Options

| Option | Consequence |
| --- | --- |
| A. Minimal Setup and Full Setup (Nix + devenv) with a shared bootstrap and Docker oracle (chosen) | Host-native default plus a finite measured gate and explicit escalation |
| B. Keep devenv as the only supported environment | One tool closure, but Nix and composition admit every contribution |
| C. Expand Docker until it matches the full environment | Duplicates browsers, Nix, generators, release, and infrastructure tooling |
| D. Document host commands without an executable oracle | Least configuration, but no failure-capable drift check |

## Decision

Choose A. A non-installing bootstrap is the host-native Minimal Setup entry
point. The root Dockerfile is its cold-start oracle and the root Compose
service is an optional bind-mounted form. Full Setup (Nix + devenv) remains
authoritative beyond the measured portable boundary.

## Consequences

- Ordinary TypeScript, stable core tests, representative Vite and Wrangler
  builds, and docs source checks do not require Nix or megarepo tooling.
- Minimal Setup admits Node.js major 24, exact repository-pinned pnpm, and Bun;
  Docker pins Bun 1.3.13 as its known-good realization.
- The portable promise remains finite; adding a capability requires clean-image
  evidence and extending the Docker gate.
- The bootstrap is an optional diagnostic for people and agents. It verifies
  readiness and installs dependencies without globally installing tools; it is
  not a validation umbrella.
- Browser downloads, generated-source tooling, wa-sqlite rebuilds, release
  state, and infrastructure remain single-owned by Full Setup (Nix + devenv).
- Compose writes through an exclusively owned checkout and does not attempt to
  coordinate shared worktree state or application ports.
- Pull requests cannot drift the portable contract unnoticed because its
  stable CI context builds the canonical Dockerfile.
- Contributor feedback is reviewed as boundary evidence so the two setups do
  not decay into recurring setup exceptions.
