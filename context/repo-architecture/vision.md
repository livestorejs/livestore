# Repository architecture — Vision

## The Problem

1. **Core reliability and integration breadth need different operating models.**
   LiveStore's engine, primary adapters, and Cloudflare sync path carry the
   production-readiness bar. Framework integrations, additional adapters,
   additional sync providers, devtools surfaces, and scaffolding tools need a
   broader contribution surface and can evolve with their ecosystems.

2. **One repository queue blurs ownership.** When every issue, pull request,
   generated workflow, release artifact, and package test lives in one repo,
   contributors and maintainers must repeatedly decide whether a change is core
   product work or community-package work.

3. **Separate repositories can easily drift.** Moving packages into another
   repo without a shared development, CI, release, and docs contract would trade
   queue clarity for version skew, duplicated tooling, and fragmented user docs.

## The Vision

- **Two repositories with one product identity.** `livestorejs/livestore` owns
  the core engine and primary integrations. `livestorejs/livestore-contrib`
  owns selected framework integrations, additional platform adapters, additional
  sync providers, devtools surfaces, and the CLI. Users still see one npm scope
  (`@livestore/*`) and one docs site (`docs.livestore.dev`).

- **A mechanical ownership boundary.** Package source, issues, pull requests,
  tests, and release responsibility live in the repository that owns the
  package. Cross-repo coordination is explicit instead of inferred from a
  shared monorepo queue.

- **Composition without duplicated infrastructure.** Contrib consumes core
  through megarepo materialization and reuses core/effect-utils tooling through
  genie composition. The repos share setup patterns without copying workflow
  logic.

- **Version and docs coherence.** Core and contrib publish lockstep package
  versions, and the core docs site renders documentation for both repositories.
  Repository ownership changes do not change user-facing package names, import
  paths, version semantics, navigation, or search.

## What This Is Not

- **Not independent product lines.** Contrib packages remain part of the
  LiveStore package family, docs site, and release story.
- **Not a package rename.** npm package names and import paths stay under
  `@livestore/*`.
- **Not duplicated tooling.** Devenv, genie, lint/format policy, CI shape,
  labels, and repo settings are derived from shared helpers.
- **Not a support taxonomy.** The repository boundary is the durable ownership
  model. Additional package classification schemes are not part of this
  architecture.
- **Not an execution plan.** Sequencing, review windows, and cleanup tasks are
  operational tracking concerns, not architecture requirements.

## Success Criteria

1. Each published `@livestore/*` package has exactly one source repository and
   exactly one release workflow responsible for publishing it.
2. A contrib package can type-check and test against the pinned core checkout
   through workspace links, without falling back to published npm packages for
   LiveStore-internal dependencies.
3. A core change that breaks a contrib package can be detected by contrib CI
   before the break reaches a contrib release.
4. `docs.livestore.dev` renders core and contrib package docs in one navigation
   and search experience.
5. Contributors can identify the correct repository for a package-scoped issue
   or pull request from the package ownership table alone.
