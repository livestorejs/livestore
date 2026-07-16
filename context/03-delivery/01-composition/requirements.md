# Delivery Composition — Requirements

Role: owns how the two repositories compose into one workspace — package
ownership, megarepo/lock semantics, dev-time dependency resolution, shared
tooling and CI composition, docs-site composition, routing, and history
preservation.

## Context

Builds on the parent [requirements.md](../requirements.md). IDs re-homed
2026-07-16 from the former flat `LS.DEL-*` set: A02→A01, A03→A02, A04→A03,
A05→A04; T01→T01, T03→T02, T04→T03; R04→R01, R05→R02, R06→R03, R07→R04,
R08→R05, R09→R06, R10→R07, R12→R08, R16→R09, R17→R10, R18→R11, R19→R12,
R20→R13, R21→R14, R22→R15, R23→R16, R24→R17; DQ1→DQ1, DQ3→DQ2.

## Assumptions

- **LS.DEL.COMP-A01 Shared tooling source:**
  `overengineeringstudio/effect-utils` supplies canonical devenv modules,
  genie helpers, CI workflow builders, label/repo settings helpers,
  oxlint/oxfmt policy, and pnpm policy.
- **LS.DEL.COMP-A02 Megarepo materialization:** `mr fetch --apply`
  materializes member repositories under `repos/` as filesystem symlinks that
  Bun, pnpm, genie, Astro/Starlight, and TypeDoc can read through.
- **LS.DEL.COMP-A03 Genie resolver scope:** `#mr/<member>/...` imports
  resolve against the file's own megarepo root. Cross-repo genie composition
  therefore uses relative imports through materialized `repos/` symlinks.
- **LS.DEL.COMP-A04 Single docs site:** `docs.livestore.dev` is the canonical
  documentation entry point for every published `@livestore/*` package.

## Acceptable Tradeoffs

- **LS.DEL.COMP-T01 Asymmetric composition cycle:** Both repos can appear in
  each other's `megarepo.lock`. The cycle is acceptable only because core
  records contrib unpinned while contrib records core pinned.
- **LS.DEL.COMP-T02 Writable materialized core checkout:** Contrib
  development and CI use a writable materialized core checkout because pnpm
  writes `node_modules` into workspace package directories.
- **LS.DEL.COMP-T03 Docs source can lag package ownership:** Contrib package
  docs may remain sourced from the core docs tree while TypeDoc/code entry
  points read contrib package source through `repos/livestore-contrib`. Full
  docs-source ownership can move later.

## Requirements

### Must Define Package Ownership

- **LS.DEL.COMP-R01 Core package set:** Core owns the engine, shared
  foundations, primary framework integration, primary browser/Cloudflare
  adapters, Cloudflare sync, and shared framework primitives.
- **LS.DEL.COMP-R02 Contrib package set:** Contrib owns selected framework
  integrations, additional platform adapters, additional sync providers,
  devtools surfaces, GraphQL integration, CLI, and their examples.
- **LS.DEL.COMP-R03 Routing by owner:** Package-scoped issues, pull requests,
  tests, and release responsibility route to the repository that owns the
  package.

### Must Compose Without Lock Ratchet

- **LS.DEL.COMP-R04 Pinned core in contrib:** Contrib's lock records core
  pinned to a deterministic commit for development and CI.
- **LS.DEL.COMP-R05 Unpinned contrib in core:** Core records contrib unpinned
  for docs-site reads and avoids coordinated lock bumps.
- **LS.DEL.COMP-R06 No implicit cross-repo lock mutation:** CI in one
  repository does not mutate the other repository's lockfile.

### Must Resolve Dependencies Consistently In Development

- **LS.DEL.COMP-R07 Workspace links during development:** Contrib packages
  resolve core package dependencies through `repos/livestore` workspace
  links, not npm.
- **LS.DEL.COMP-R08 No duplicate LiveStore identities:** Live development
  workspaces avoid pnpm settings that make TypeScript see duplicated
  `@livestore/*` package identities through generated outputs or GVS links.

### Must Share Tooling

- **LS.DEL.COMP-R09 Same devenv stack:** Contrib imports the same
  effect-utils devenv modules as core.
- **LS.DEL.COMP-R10 Shared genie helpers, local ownership manifests:**
  Contrib's generated workspace, package, TypeScript, lint/format, CI,
  labels, and repo settings files are composed from core/effect-utils helpers
  rather than handwritten copies. Final contrib package and example
  membership is owned by contrib, not by core's package topology.
- **LS.DEL.COMP-R11 Contrib-specific CI identifiers:** Contrib CI uses
  contrib-scoped cache, Cachix, and pnpm state identifiers even when it
  reuses core's setup atoms.
- **LS.DEL.COMP-R12 Same lint and format policy:** Contrib derives oxlint and
  oxfmt configuration from the same base policy as core.

### Must Preserve Unified Documentation

Interacts with `../../04-docs/`.

- **LS.DEL.COMP-R13 Single docs URL:** `docs.livestore.dev` remains the only
  public docs URL for LiveStore packages. `refines: LS-R16`
- **LS.DEL.COMP-R14 Unified docs navigation and search:** Core and contrib
  package docs render in one sidebar and one search index.
  `refines: LS-R16`
- **LS.DEL.COMP-R15 Docs build materializes contrib:** Core's docs build
  materializes contrib before reading contrib TypeDoc entry points or docs
  content.

### Must Preserve History

- **LS.DEL.COMP-R16 Package history retained:** Contrib package directories
  preserve relevant pre-move commit history through filtered history import.
- **LS.DEL.COMP-R17 Source commit traceability:** The history import records
  the source core commit used to establish contrib ownership.
