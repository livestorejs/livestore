# Two-repo composition — key design tradeoffs

A single ADR consolidating the architectural tradeoffs behind the two-repo
system. Each subsection records one decision with the alternatives we
considered. Granular tradeoffs without surprising rationale stay as `T0N`
entries in [requirements.md](../requirements.md).

## Composition shape: asymmetric megarepo

Both repos appear in each other's `megarepo.lock`. Contrib is recorded
**unpinned** in core's lock; core is **pinned** in contrib's lock. The
graph cycle is benign because the unpinned edge never participates in a
coordinated bump — nothing in core's CI has to update contrib's pin, and
contrib's CI tests against a deterministic core commit.

| Option | Rejected because |
|---|---|
| Bidirectional pinned | Every push in either repo forces a coordinated lock bump in the other |
| One-way (core does not list contrib) | Core's docs build still needs a contrib fetch; a member entry is the same machinery used everywhere else |
| Custom fetch in core's docs build (shallow git clone) | Introduces a second cross-repo fetch pattern that diverges from `mr` |

## Runtime dep resolution: pnpm workspace via megarepo

Contrib's packages consume core's via the materialized `repos/livestore/`
symlink, exposed to contrib's pnpm-workspace. Resolution produces `link:`
entries pointing into the symlinked core checkout. At publish time the
workflow rewrites `workspace:*` to a pinned exact version (which combines
with the version-stamp decision below).

| Option | Rejected because |
|---|---|
| Published npm versions during dev | Contrib lags against core; breaking changes ship to users before contrib notices |
| Hybrid (workspace dev, npm CI) | Adds a toggle without removing either failure mode |

Operational note: pnpm writes `node_modules/` into the resolved workspace
members. The materialized core checkout under `repos/livestore/` must
therefore be writable (a regular `mr apply` checkout — fine; a read-only
megarepo-store checkout — not fine).

## Versioning: lockstep one-to-one

Contrib's published package versions mirror core's version stamp exactly.
Contrib releases on every core release even when contrib code is
unchanged. Trades an extra release event per core patch for a trivial
user mental model ("0.4.2 of everything was tested together") and a
deterministic publish pipeline.

| Option | Rejected because |
|---|---|
| Independent versioning + range deps | Silent drift — the failure mode the split is meant to prevent |
| Mirror version, range deps | Loses determinism without removing the no-op release cost |

## Genie composition: relative-path imports, not `#mr/livestore/...`

Contrib's genie projections import livestore's helpers via relative path
(`../repos/livestore/genie/repo.ts`). This is forced by how the genie
import-map resolver works: `#mr/<member>/...` is resolved against the
file's own megarepo root, not the calling repo's. A naive
`#mr/livestore/...` import from contrib triggers transitive
`#mr/effect-utils/...` resolution from a location where effect-utils is
not visible, and resolution fails.

Relative paths sidestep the resolver entirely: Bun reads the symlinked
file, and once execution is inside livestore's source the inner
`#mr/effect-utils/...` resolves against livestore's own `repos/`, which
`mr apply` materializes inside contrib at `repos/livestore/repos/effect-utils/`.

Forward dependency tracked in epic #1265: livestore's `genie/repo.ts`
needs to re-export the constituent CI step atoms so contrib can compose
its own CI without taking the `livestoreSetupSteps` composite (which
hardcodes `cachix.name = "livestore"` and a livestore-scoped pnpm state
key).

## Package classification: `framework-toolkit` stays in core

The initial framing moved every framework integration plus its toolkit
to contrib. A dependency audit found that `@livestore/react` (staying in
core) imports from `framework-toolkit` at four sites
(`packages/@livestore/react/src/{mod,useQuery,useClientDocument}.ts`).
Moving `framework-toolkit` would break React in core.

`framework-toolkit` is reclassified as core. It's the shared primitive
every framework integration is built on (React, Solid, Svelte all use
it), so it belongs alongside the engine and the primary integration that
ships from core. `solid` in contrib continues to consume `framework-toolkit`
through the pnpm-workspace-over-symlink mechanism above.

| Option | Rejected because |
|---|---|
| Move framework-toolkit and react together | React is the flagship core integration — contradicts every other framing |
| Refactor react to drop the framework-toolkit dep | Significant work, not bootstrap-PR scope, and framework-toolkit is doing exactly the job it was designed for |

## Docs source migration: deferred to a follow-up

The end-state is contrib owning the source for its package docs
(`livestore-contrib/docs-content/`), with core's docs site mounting that
content via the megarepo symlink (Approach C from the docs investigation).
The bootstrap PR ships the interim: contrib package docs stay in
`livestore/docs/src/content/docs/`, TypeDoc and code-snippet paths
retarget through `repos/livestore-contrib/packages/...` after the
symlink is materialized.

The bootstrap PR already carries filter-repo extraction of 10 packages,
the contrib skeleton, and ~60 deletion sites in core. Adding the docs
source migration (sidebar.ts composition, symlink mount, Starlight
content-collection refactor) would multiply the review surface in a
category orthogonal to the structural split.

Cost: until the follow-up lands, editing a contrib package's docs
requires touching the core repo even though the package lives in
contrib. Annoying but not broken; the friction itself motivates
scheduling the follow-up. Tracked in epic #1265.
