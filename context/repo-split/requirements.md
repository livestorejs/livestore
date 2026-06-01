# Repo split — Requirements

## Context

Builds on [vision.md](./vision.md). Implementation details — exact file
layouts, command invocations, genie projection shapes — live in
[spec.md](./spec.md).

## Assumptions

- **A01 Two repos, one org:** Both repositories live under the
  `livestorejs` GitHub organization. The npm namespace `@livestore` is owned
  by the same organization and grants publish access to both repos'
  release workflows.
- **A02 Shared tooling source:** `overengineeringstudio/effect-utils` is a
  megarepo member of both repos and supplies the canonical devenv modules,
  genie helpers (CI workflow builders, label catalog, repo settings),
  oxlint/oxfmt configuration, and pnpm policy.
- **A03 Materialized megarepo at build/CI time:** `mr fetch --apply`
  materializes member repositories as filesystem symlinks under `repos/`.
  Tooling (Bun, pnpm, genie, Astro/Starlight, TypeDoc) resolves paths
  through those symlinks transparently.
- **A04 Genie scoping:** The genie binary resolves `#mr/<member>/...`
  specifiers against the file's own megarepo root, not against the
  invoking repo's root. Transitive `#mr/...` imports inside a member's
  source files therefore do not chase through nested megarepos.
- **A05 Public docs entry point:** `docs.livestore.dev` is and continues to
  be the canonical user-facing documentation site for every published
  `@livestore/*` package, regardless of which repository hosts the package.
- **A06 Hypermerge active in core:** `livestorejs/livestore` uses the
  Hypermerge merge queue (`mq:*` labels). `livestore-contrib` adopts the
  same merge queue from day one to keep merge ergonomics identical across
  the two repos.

## Acceptable Tradeoffs

- **T01 Bidirectional composition graph:** Both repos appear in each other's
  `megarepo.lock` (contrib pins core; core lists contrib). The cycle is
  accepted because contrib is recorded **unpinned** in core's lock —
  removing the lock-ratchet failure mode while preserving a single
  composition mechanism.
- **T02 Lockstep release cadence:** Contrib's published package versions
  mirror core's version stamp exactly. Contrib re-releases on every core
  release even when contrib code has not changed. The cost (extra release
  events) buys predictable version semantics for users ("0.4.2 of
  everything") and a simpler version-resolution story than range deps.
- **T03 Filter-repo over-inclusion:** History extraction via `git
  filter-repo` may retain a small number of merge-ancestry commits for each
  moved path that do not appear in the canonical tree diff (observed: up to
  +4 commits per package). Accepted as harmless noise; no commits are
  dropped.
- **T04 Contrib docs source stays in core during bootstrap:** The end-state
  is contrib owning the source for its package docs. The bootstrap retains
  contrib package docs in `livestore/docs/src/content/docs/` and retargets
  TypeDoc paths through the megarepo symlink. The full source-of-truth
  migration is a separate follow-up PR to contain bootstrap scope.

## Requirements

### Must preserve npm publish identity

- **R01 Package names unchanged:** Every moved package retains its
  `@livestore/<name>` npm name. No user-facing `package.json` edit is
  required to consume a moved package after the migration.
- **R02 Single publisher per package:** After the migration, each published
  `@livestore/*` package is published from exactly one repository's release
  workflow. There is no window during which both repositories publish the
  same package.

### Must preserve user-facing docs identity

- **R03 Single docs URL:** `docs.livestore.dev` continues to serve as the
  sole documentation entry point for all `@livestore/*` packages.
- **R04 Unified navigation and search:** The docs site renders content for
  both repos' packages within a single sidebar and a single search index.

### Must avoid bidirectional lock-ratchet

- **R05 Asymmetric lock pinning:** Core's `megarepo.lock` records contrib
  with `pinned: false`. Contrib's `megarepo.lock` records core with
  `pinned: true` (contrib's CI tests against a deterministic core
  commit; core's docs build tracks contrib HEAD on each fetch).
- **R06 No automated cross-repo lock bumps:** Neither repo's CI mutates the
  other repo's lock. Lock updates are explicit, human-initiated, and scoped
  to the repo whose lock is being updated.

### Must release in version lockstep

- **R07 Mirrored version stamps:** A contrib release at any time stamps
  every contrib package at exactly the version core's latest release used.
  Contrib never publishes a version stamp that does not exist in core.
- **R08 Release triggered by core:** Core's release workflow dispatches a
  contrib release as its final step. Manual contrib releases are supported
  but expected to be rare.
- **R09 Pinned cross-repo deps at publish:** Contrib packages depending on a
  core package declare an exact pinned dep (e.g.
  `"@livestore/react": "0.4.2"`) at publish time. The `workspace:*`
  protocol used during development is resolved to the pinned version by the
  release workflow.

### Must enforce attention boundary

- **R10 Contrib-package issues in contrib:** New issues concerning a moved
  package are filed in `livestorejs/livestore-contrib`. Issues filed in
  core that concern moved packages are transferred via `gh issue transfer`
  or closed with a pointer.
- **R11 Contrib-package PRs in contrib:** Pull requests modifying any moved
  package open against `livestorejs/livestore-contrib`. Core's CI does not
  build, test, or lint contrib packages.
- **R12 No core-team SLA on contrib:** The core team is not the SLA-bearing
  reviewer for contrib PRs. Community reviewers and automation are the
  expected primary signal.

### Must align tooling with core

- **R13 Same devenv stack:** Contrib's devenv configuration imports the
  same effect-utils devenv modules core does. A contributor with a working
  core checkout has all of contrib's tooling already installed.
- **R14 Same genie projection generators:** Contrib's
  `pnpm-workspace.yaml`, `package.json`, `tsconfig.dev.json`, and CI
  workflow are generated by the same genie helpers core uses, composed via
  relative-path imports of `repos/livestore/genie/repo.ts`.
- **R15 Same lint and format configuration:** Contrib's `.oxlintrc.json`
  and `.oxfmtrc.json` are derived from the same effect-utils base via
  contrib's genie projections.
- **R16 Same CI workflow shape:** Contrib's CI runs the same job kinds
  (lint, type-check, build, per-package test) as core, composed from the
  same effect-utils CI builders. The contrib package set replaces the core
  package set in the matrix.
- **R17 Same label IaC:** Contrib's `.github/labels.json` is generated from
  the same effect-utils shared catalog core uses, plus any contrib-local
  area labels. No tier labels (the prior `tier:*` exploration is closed).
- **R18 Same repo settings IaC:** Contrib's `.github/repo-settings.json`
  is generated from the same effect-utils ruleset and branch-protection
  helpers core uses.

### Must support efficient development

- **R19 Single command bootstraps a contrib checkout:** A contributor
  cloning `livestorejs/livestore-contrib` runs `direnv allow` (entering the
  devenv) and `mr fetch --apply` to materialize core. No further setup is
  required to run lint, type-check, or build.
- **R20 Workspace dep resolution across repos:** A contrib package's
  workspace dep on a core package (e.g. `@livestore/svelte` →
  `@livestore/react`) resolves through the `repos/livestore` symlink as a
  `link:` workspace dependency. The resolution does not fall back to npm
  for any `@livestore/*` package.
- **R21 Docs site dev preview reads contrib content:** Running the core
  docs dev server resolves contrib package TypeDoc sources and contrib
  docs content via `mr fetch --only livestore-contrib --apply` followed by
  filesystem reads through the `repos/livestore-contrib` symlink.

### Must preserve historical attribution

- **R22 Migrated package history:** Pre-migration commits to moved
  packages remain attributable in `livestore-contrib`'s git log via
  `git filter-repo` extraction. Commit authorship, dates, and messages
  are preserved.
- **R23 Migration commit pointer:** Each moved package directory in
  contrib includes a migration commit on its head whose message points at
  the source commit in livestore at the time of the move.
