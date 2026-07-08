# Repository architecture — Requirements

## Context

Builds on [vision.md](./vision.md). Implementation details live in
[spec.md](./spec.md). Operational sequencing is tracked outside the VRS.

## Assumptions

- **A01 Shared organization:** `livestorejs/livestore` and
  `livestorejs/livestore-contrib` live under the `livestorejs` GitHub
  organization and publish packages under the `@livestore` npm scope.
- **A02 Shared tooling source:** `overengineeringstudio/effect-utils` supplies
  canonical devenv modules, CI workflow builders, label/repo
  settings helpers, oxlint/oxfmt policy, and pnpm policy.
- **A03 Megarepo materialization:** `mr fetch --apply` materializes member
  repositories under `repos/` as filesystem symlinks that Bun, pnpm,
  Astro/Starlight, and TypeDoc can read through.
- **A04 Megarepo resolver scope:** `#mr/<member>/...` imports resolve against
  the file's own megarepo root. Cross-repo composition therefore uses relative
  imports through materialized `repos/` symlinks.
- **A05 Single docs site:** `docs.livestore.dev` is the canonical
  documentation entry point for every published `@livestore/*` package.

## Acceptable Tradeoffs

- **T01 Asymmetric composition cycle:** Both repos can appear in each other's
  `megarepo.lock`. The cycle is acceptable only because core records contrib
  unpinned while contrib records core pinned.
- **T02 Lockstep contrib releases:** Contrib mirrors core's version stamp and
  can release even when contrib source did not change. Extra release events are
  acceptable because users get deterministic "same version was tested together"
  semantics.
- **T03 Writable materialized core checkout:** Contrib development and CI use a
  writable materialized core checkout because pnpm writes `node_modules` into
  workspace package directories.
- **T04 Docs source can lag package ownership:** Contrib package docs may remain
  sourced from the core docs tree while TypeDoc/code entry points read contrib
  package source through `repos/livestore-contrib`. Full docs-source ownership
  can move later.

## Requirements

### Must Preserve User-Facing Package Identity

- **R01 Package names unchanged:** Every package keeps its `@livestore/<name>`
  npm name regardless of source repository.
- **R02 Import paths unchanged:** Moving source repositories does not require
  user code import changes.
- **R03 Single publisher per package:** Each published package is published by
  exactly one repository's release workflow.

### Must Define Package Ownership

- **R04 Core package set:** Core owns the engine, shared foundations, primary
  framework integration, primary browser/Cloudflare adapters, Cloudflare sync,
  and shared framework primitives.
- **R05 Contrib package set:** Contrib owns selected framework integrations,
  additional platform adapters, additional sync providers, devtools surfaces,
  GraphQL integration, CLI, and their examples.
- **R06 Routing by owner:** Package-scoped issues, pull requests, tests, and
  release responsibility route to the repository that owns the package.

### Must Compose Without Lock Ratchet

- **R07 Pinned core in contrib:** Contrib's lock records core pinned to a
  deterministic commit for development and CI.
- **R08 Unpinned contrib in core:** Core records contrib unpinned for docs-site
  reads and avoids coordinated lock bumps.
- **R09 No implicit cross-repo lock mutation:** CI in one repository does not
  mutate the other repository's lockfile.

### Must Resolve Dependencies Consistently

- **R10 Workspace links during development:** Contrib packages resolve core
  package dependencies through `repos/livestore` workspace links, not npm.
- **R11 Exact versions at publish:** Contrib release manifests rewrite
  `workspace:*` dependencies on core packages to exact published versions.
- **R12 No duplicate LiveStore identities:** Live development workspaces avoid
  pnpm settings that make TypeScript see duplicated `@livestore/*` package
  identities through generated outputs or GVS links.

### Must Release In Lockstep

- **R13 Mirrored version stamp:** A contrib release uses the latest core version
  stamp exactly.
- **R14 Core-triggered contrib release:** Core's release workflow dispatches the
  matching contrib release after core packages publish.
- **R15 Manual contrib release escape hatch:** Contrib can manually publish the
  current core version stamp for a contrib-only release repair.

### Must Share Tooling

- **R16 Same devenv stack:** Contrib imports the same effect-utils devenv
  modules as core.
- **R17 Shared helpers, local ownership manifests:** Contrib's workspace,
  package, TypeScript, lint/format, CI, labels, and repo settings files are
  composed from core/effect-utils helpers rather than handwritten copies. Final
  contrib package and example membership is owned by contrib, not by core's
  package topology.
- **R18 Contrib-specific CI identifiers:** Contrib CI uses contrib-scoped cache,
  Cachix, and pnpm state identifiers even when it reuses core's setup atoms.
- **R19 Same lint and format policy:** Contrib derives oxlint and oxfmt
  configuration from the same base policy as core.

### Must Preserve Unified Documentation

- **R20 Single docs URL:** `docs.livestore.dev` remains the only public docs
  URL for LiveStore packages.
- **R21 Unified docs navigation and search:** Core and contrib package docs
  render in one sidebar and one search index.
- **R22 Docs build materializes contrib:** Core's docs build materializes
  contrib before reading contrib TypeDoc entry points or docs content.

### Must Preserve History

- **R23 Package history retained:** Contrib package directories preserve
  relevant pre-move commit history through filtered history import.
- **R24 Source commit traceability:** The history import records the source
  core commit used to establish contrib ownership.
