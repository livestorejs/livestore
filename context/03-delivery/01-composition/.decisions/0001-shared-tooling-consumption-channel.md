# 0001 — Consume shared tooling as Nix-built binaries, not workspace packages

Status: accepted (2026-07-27, confirmed with the maintainer during the design
interview that produced this record). Evidence: a clean clone of this branch with
no `repos/` present ran `pnpm install` (exit 0), `tsgo --build tsconfig.json`
(exit 0, no errors), and one unit-lane project,
`vitest packages/@livestore/common/src` (19 files, 268 tests passed). The
structural basis is independent of that sample: `scripts/tsconfig.json` excludes
`**/*.genie.ts`, so the only `#mr/effect-utils/...` import is outside the
typecheck graph, and neither root nor `scripts/` declares an `@overeng/*`
dependency or an `imports` map.

## Context

`overengineeringstudio/effect-utils` supplies this repo's shared tooling
(LS.DEL.COMP-A01). When a mechanism belongs upstream — the case that forced this
decision was the test-quarantine contract, whose entry semantics and CI emit
channel are not LiveStore's to own — the question is _how_ core consumes it.

Three channels exist, and they differ in what they cost a contributor:

| Channel               | Reaches core via                                           | Requires materialization to install? |
| --------------------- | ---------------------------------------------------------- | ------------------------------------ |
| Nix-built binary      | `inputs.effect-utils` flake input, pinned by `devenv.lock` | no                                   |
| Genie helper          | `#mr/effect-utils/...`, resolved by Genie's own resolver   | only to regenerate                   |
| npm workspace package | a `repos/effect-utils/...` entry in `pnpm-workspace.yaml`  | **yes**                              |

The third looks like the obvious way to share TypeScript, and it is the one that
does real damage. `repos/` is gitignored and every `@overeng/*` package is
`"private": true`, so a workspace entry would make `pnpm install` fail on a fresh
clone until `mr apply` had run — for every external contributor of a public repo,
and for every CI job.

## Decision

Shared tooling reaches core as **Nix-built binaries** from the `effect-utils`
flake input. `genie`, `effect-tsgo`, `megarepo`, and `ci-tools` already arrive
this way; new shared mechanisms follow them.

Genie remains the exception, and only at generation time: its sources import
`#mr/effect-utils/...` and its outputs are committed, so a contributor who does
not regenerate never needs materialization. That boundary is now stated as
LS.DEL.COMP-R19 rather than left implicit.

The cost is a process boundary — a consumer invokes a CLI and serializes its
input rather than importing a function. For the quarantine case that is one
subprocess per tolerated failure, which is rare by construction.

## Alternatives considered

- **`pnpm-workspace.yaml` entry into `repos/effect-utils`.** In-process, no
  serialization, and the natural way to share TypeScript. Rejected: it makes
  installation depend on materialization, which breaks the fresh-clone path for
  a public repo. Contrib does exactly this for core, but contrib is the
  downstream repo of that pair — core is the one that must stand alone.
- **Publish `@overeng/ci-tools` to npm and depend on a version.** Removes the
  materialization requirement and keeps in-process ergonomics. Rejected for now:
  it needs a real release process and semver commitment, and it reintroduces a
  version-skew axis between the two repos that `megarepo.lock` currently
  eliminates. This is the right answer if the package ever needs consumers
  outside the megarepo.
- **Copy the mechanism into core and keep it in sync.** Rejected: it leaves the
  upstream facts restated here, which is the defect that prompted the decision —
  a copy of behavior nothing detects going stale.
