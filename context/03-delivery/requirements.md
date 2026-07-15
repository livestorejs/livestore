# Delivery — Requirements

**Role:** Owns how LiveStore ships: repository/package composition, packaging,
release, versioning, and artifact flows. The product is delivered from two
repositories — `livestorejs/livestore` (core) and `livestorejs/livestore-contrib`
(contrib) — as one package family with a mechanical ownership boundary.
Refines root `LS-A04` (two-repo delivery) and `LS-R16` (one product identity).

## Context

Builds on the root [requirements.md](../requirements.md). Implementation
details live in [spec.md](./spec.md). Operational sequencing is tracked
outside the VRS.

## Assumptions

- **LS.DEL-A01 Shared organization:** `livestorejs/livestore` and
  `livestorejs/livestore-contrib` live under the `livestorejs` GitHub
  organization and publish packages under the `@livestore` npm scope.
- **LS.DEL-A02 Shared tooling source:** `overengineeringstudio/effect-utils`
  supplies canonical devenv modules, genie helpers, CI workflow builders,
  label/repo settings helpers, oxlint/oxfmt policy, and pnpm policy.
- **LS.DEL-A03 Megarepo materialization:** `mr fetch --apply` materializes
  member repositories under `repos/` as filesystem symlinks that Bun, pnpm,
  genie, Astro/Starlight, and TypeDoc can read through.
- **LS.DEL-A04 Genie resolver scope:** `#mr/<member>/...` imports resolve
  against the file's own megarepo root. Cross-repo genie composition therefore
  uses relative imports through materialized `repos/` symlinks.
- **LS.DEL-A05 Single docs site:** `docs.livestore.dev` is the canonical
  documentation entry point for every published `@livestore/*` package.

## Acceptable Tradeoffs

- **LS.DEL-T01 Asymmetric composition cycle:** Both repos can appear in each
  other's `megarepo.lock`. The cycle is acceptable only because core records
  contrib unpinned while contrib records core pinned.
- **LS.DEL-T02 Lockstep contrib releases:** Contrib mirrors core's version
  stamp and can release even when contrib source did not change. Extra release
  events are acceptable because users get deterministic "same version was
  tested together" semantics.
- **LS.DEL-T03 Writable materialized core checkout:** Contrib development and
  CI use a writable materialized core checkout because pnpm writes
  `node_modules` into workspace package directories.
- **LS.DEL-T04 Docs source can lag package ownership:** Contrib package docs
  may remain sourced from the core docs tree while TypeDoc/code entry points
  read contrib package source through `repos/livestore-contrib`. Full
  docs-source ownership can move later.

## Requirements

### Must Preserve User-Facing Package Identity

Refines root `LS-R16`.

- **LS.DEL-R01 Package names unchanged:** Every package keeps its
  `@livestore/<name>` npm name regardless of source repository.
- **LS.DEL-R02 Import paths unchanged:** Moving source repositories does not
  require user code import changes.
- **LS.DEL-R03 Single publisher per package:** Each published package is
  published by exactly one repository's release workflow.

### Must Define Package Ownership

- **LS.DEL-R04 Core package set:** Core owns the engine, shared foundations,
  primary framework integration, primary browser/Cloudflare adapters,
  Cloudflare sync, and shared framework primitives.
- **LS.DEL-R05 Contrib package set:** Contrib owns selected framework
  integrations, additional platform adapters, additional sync providers,
  devtools surfaces, GraphQL integration, CLI, and their examples.
- **LS.DEL-R06 Routing by owner:** Package-scoped issues, pull requests,
  tests, and release responsibility route to the repository that owns the
  package.

### Must Compose Without Lock Ratchet

- **LS.DEL-R07 Pinned core in contrib:** Contrib's lock records core pinned to
  a deterministic commit for development and CI.
- **LS.DEL-R08 Unpinned contrib in core:** Core records contrib unpinned for
  docs-site reads and avoids coordinated lock bumps.
- **LS.DEL-R09 No implicit cross-repo lock mutation:** CI in one repository
  does not mutate the other repository's lockfile.

### Must Resolve Dependencies Consistently

- **LS.DEL-R10 Workspace links during development:** Contrib packages resolve
  core package dependencies through `repos/livestore` workspace links, not
  npm.
- **LS.DEL-R11 Exact versions at publish:** Contrib release manifests rewrite
  `workspace:*` dependencies on core packages to exact published versions.
- **LS.DEL-R12 No duplicate LiveStore identities:** Live development
  workspaces avoid pnpm settings that make TypeScript see duplicated
  `@livestore/*` package identities through generated outputs or GVS links.

### Must Release In Lockstep

- **LS.DEL-R13 Mirrored version stamp:** A contrib release uses the latest
  core version stamp exactly.
- **LS.DEL-R14 Core-triggered contrib release:** Core's release workflow
  dispatches the matching contrib release after core packages publish.
- **LS.DEL-R15 Manual contrib release escape hatch:** Contrib can manually
  publish the current core version stamp for a contrib-only release repair.

### Must Share Tooling

- **LS.DEL-R16 Same devenv stack:** Contrib imports the same effect-utils
  devenv modules as core.
- **LS.DEL-R17 Shared genie helpers, local ownership manifests:** Contrib's
  generated workspace, package, TypeScript, lint/format, CI, labels, and repo
  settings files are composed from core/effect-utils helpers rather than
  handwritten copies. Final contrib package and example membership is owned by
  contrib, not by core's package topology.
- **LS.DEL-R18 Contrib-specific CI identifiers:** Contrib CI uses
  contrib-scoped cache, Cachix, and pnpm state identifiers even when it reuses
  core's setup atoms.
- **LS.DEL-R19 Same lint and format policy:** Contrib derives oxlint and oxfmt
  configuration from the same base policy as core.

### Must Preserve Unified Documentation

Refines root `LS-R16`; interacts with `04-docs/`.

- **LS.DEL-R20 Single docs URL:** `docs.livestore.dev` remains the only public
  docs URL for LiveStore packages.
- **LS.DEL-R21 Unified docs navigation and search:** Core and contrib package
  docs render in one sidebar and one search index.
- **LS.DEL-R22 Docs build materializes contrib:** Core's docs build
  materializes contrib before reading contrib TypeDoc entry points or docs
  content.

### Must Preserve History

- **LS.DEL-R23 Package history retained:** Contrib package directories
  preserve relevant pre-move commit history through filtered history import.
- **LS.DEL-R24 Source commit traceability:** The history import records the
  source core commit used to establish contrib ownership.
