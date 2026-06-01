# Repo split — Vision

## The Problem

1. **Core engine reliability competes with everything else.** LiveStore's core
   sync/storage/event engine has known production-readiness gaps (storage
   growth on the Cloudflare adapter, edge cases under online/offline
   transitions, irrecoverable states, lack of comprehensive benchmarks). In a
   single-repo world, attention to those problems competes with framework
   integrations, additional platform adapters, additional sync providers, and
   devtools — every issue and PR lands in the same queue, every CI run blocks
   on the same matrix.

2. **A shared queue conflates incompatible quality expectations.** The core
   engine carries a "production-ready" bar. Framework integrations,
   sponsor-driven sync providers, and community adapters carry a "best-effort,
   evolves with the ecosystem" bar. In one repo these bars have to be
   negotiated implicitly per issue and per PR, which neither tier serves well.

3. **Maintainer time is finite and the soft "focus on core" posture has not
   held.** Without a hard mechanical boundary, focus remains aspirational. The
   2026-05-28 contributor sync established consensus that a structural change
   is needed.

## The Vision

- **Two repositories with one user-facing identity.** `livestorejs/livestore`
  owns the engine and its primary integrations. `livestorejs/livestore-contrib`
  hosts framework integrations, additional adapters, additional sync
  providers, devtools, and the CLI. The split is operational; the npm
  namespace (`@livestore/*`) and the docs site (`docs.livestore.dev`) stay
  unified.

- **Attention boundary is mechanical, not procedural.** Core's issue and PR
  queue is scoped to core packages. Contrib's queue is scoped to contrib
  packages. There is no "is this a core PR?" judgment to make on every change.

- **Composition without coupling penalty.** Contrib consumes core packages
  through megarepo materialization, so contrib's CI tests against current
  core. Drift between contrib's view of core and reality is caught before
  users see it, not after.

- **Community-led contrib with automated baseline maintenance.** Contrib
  packages are explicitly community-maintained. Automation handles routine
  upkeep (dependency bumps, lint, baseline CI). Human review depth scales with
  contributor engagement, not with maintainer SLA.

## What This Is Not

- **Not a rename.** npm package names are unchanged. Users do not edit
  `package.json` to track the move.
- **Not a deprecation.** Contrib packages remain published, supported by the
  community, and demonstrated by example apps that move with them.
- **Not a fork.** Both repos sit in the same GitHub org under the same npm
  namespace. There is one docs URL, one design language, one tooling stack.
- **Not a tiering scheme.** The earlier exploration of three-tier package
  classification (closed via #1261) is superseded — the repository boundary is
  the only classification that matters.
- **Not a separation of build infrastructure.** Both repos share the same
  devenv, the same genie projections, the same lint/format configuration, the
  same CI workflow shape. Composition over duplication.

## Success Criteria

1. Core repo's open issue + PR queue contains zero items scoped to packages
   that have moved to contrib (after the migration cleanup completes).
2. Contrib's CI catches a hypothetical breaking change in core's `@livestore/react`
   before that core change merges into a contrib-published release.
3. A user installing `@livestore/svelte` from npm experiences no change in
   `package.json` shape or import paths attributable to the split.
4. A community contributor opening a PR against `@livestore/sync-electric`
   does so against `livestore-contrib` and the PR runs the same lint, format,
   and type-check stack the contributor would encounter in core.
5. `docs.livestore.dev` continues to render documentation for every published
   `@livestore/*` package after the split, with no fragmentation in
   navigation or search.
