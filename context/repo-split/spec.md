# Repo split — Spec

This document specifies how `livestorejs/livestore` and
`livestorejs/livestore-contrib` compose as a two-repo system. It builds on
[requirements.md](./requirements.md).

## Status

Draft — pending bootstrap PR.

## Scope

Defines:
- The composition topology between the two repos (megarepo membership,
  symlink layout, pnpm-workspace shape).
- The final package classification (which `@livestore/*` packages live in
  which repo).
- Dependency resolution at dev/CI time and at publish time.
- Release flow (lockstep stamping).
- CI design (genie-composed mirror of core's shape).
- Docs site composition (asymmetric megarepo, contrib unpinned).
- Issue and PR routing.
- Genie composition mechanics (relative-path imports, not `#mr/`).

Does not define:
- Internal designs of individual packages (each package owns its own
  documentation under its directory).
- The migration sequence and execution checklist (that lives in the
  migration epic, livestorejs/livestore#1265).
- The core engine's internal architecture or roadmap (lives in core's own
  context directory if and when authored).

## Composition topology

```
                    ┌──────────────────────────────┐
                    │  livestorejs/livestore       │
                    │  (core)                      │
                    │                              │
                    │  packages/@livestore/*       │
                    │  docs/                       │
                    │  megarepo.lock               │
                    │  ├── effect-utils (pinned)   │
                    │  ├── effect       (unpinned) │
                    │  └── livestore-contrib       │
                    │           (UNPINNED)         │
                    │  repos/                      │
                    │  ├── effect-utils -> store   │
                    │  ├── effect       -> store   │
                    │  └── livestore-contrib       │
                    │           -> store           │
                    └──────────────────────────────┘
                                  ▲
                                  │  (unpinned, fetched at docs-build time
                                  │   only; never mutated by contrib CI)
                                  │
                    ┌──────────────────────────────┐
                    │  livestorejs/livestore-contrib│
                    │                              │
                    │  packages/@livestore/*       │
                    │     (moved subset)           │
                    │  examples/                   │
                    │  megarepo.lock               │
                    │  ├── effect-utils (pinned)   │
                    │  ├── effect       (unpinned) │
                    │  └── livestore     (PINNED)  │
                    │  repos/                      │
                    │  ├── effect-utils -> store   │
                    │  ├── effect       -> store   │
                    │  └── livestore     -> store  │
                    └──────────────────────────────┘
```

The cycle in the graph is benign because the edge from core → contrib is
**unpinned** (R05). Core's lock records "the SHA mr fetched last time" without
any coordination requirement; bumping it has no semantic meaning.

## Package classification

| Package | Repo | Why |
|---|---|---|
| `livestore` | core | Top-level entry / engine root |
| `common` | core | Engine internals |
| `common-cf` | core | Cloudflare engine internals; paired with `sync-cf` |
| `utils` | core | Used by every package |
| `utils-dev` | core | Test infrastructure |
| `peer-deps` | core | Catalog management |
| `react` | core | Primary framework integration |
| `adapter-web` | core | Primary browser adapter |
| `adapter-cloudflare` | core | Production adapter, sync-cf foundation |
| `sync-cf` | core | Primary sync provider |
| `sqlite-wasm` | core | wa-sqlite consumer surface |
| `wa-sqlite` | core | Vendored SQLite |
| `webmesh` | core | Cross-worker mesh primitive |
| `framework-toolkit` | core | Imported by `react`; required by every framework integration |
| `svelte` | contrib | Community framework integration |
| `solid` | contrib | Community framework integration |
| `adapter-node` | contrib | Node platform adapter |
| `adapter-expo` | contrib | Expo platform adapter |
| `devtools-expo` | contrib | Paired with `adapter-expo` |
| `devtools-web-common` | contrib | Shared devtools surface for contrib adapters |
| `sync-electric` | contrib | Sync provider |
| `sync-s2` | contrib | Sync provider |
| `graphql` | contrib | Optional integration |
| `cli` | contrib | Scaffolding + MCP server |

`effect-playwright` moves to `overengineeringstudio/effect-utils` (tracked
in #1259) and does not appear in either repo's final package set.

## Dependency resolution

### At development and CI

```
livestore-contrib/
├── pnpm-workspace.yaml
│   packages:
│     - 'packages/@livestore/*'                       # contrib's own packages
│     - 'repos/livestore/packages/@livestore/*'       # core packages via symlink
│     - 'repos/livestore/packages/@local/*'           # core's local helpers
└── repos/livestore -> .../canonical-livestore-store
```

A workspace dep declaration in `packages/@livestore/svelte/package.json`:

```json
{
  "dependencies": {
    "@livestore/react":    "workspace:*",
    "@livestore/utils-dev": "workspace:*"
  }
}
```

`pnpm install` resolves both as `link:` workspace entries pointing into
`repos/livestore/packages/@livestore/...` (proven in derisking — observed
output: `@livestore/react@link:../../../repos/livestore/packages/@livestore/react`).

Importantly: `pnpm install` writes `node_modules/` into the resolved workspace
member's directory. Because `repos/livestore/` materializes a real writable
git checkout (not the read-only canonical store), this works without any
copy-on-write or overlay machinery.

### At publish time

The release workflow rewrites every `workspace:*` dep to the exact published
version of the core package at the time of the release. So a published
`@livestore/svelte@0.4.2` carries:

```json
{
  "dependencies": {
    "@livestore/react": "0.4.2",
    "@livestore/utils-dev": "0.4.2"
  }
}
```

Pinned-exact, never ranged. Combined with R07 (mirrored version stamps), the
release graph is fully deterministic from a user's `package.json`.

## Release flow

```
sequenceDiagram
    participant Maintainer
    participant CoreCI as livestore CI
    participant npm
    participant Dispatch as repository_dispatch
    participant ContribCI as livestore-contrib CI

    Maintainer->>CoreCI: tag v0.4.2 on dev
    CoreCI->>npm: publish @livestore/{livestore, common, react, ...}@0.4.2
    CoreCI->>Dispatch: dispatch contrib-release event { version: "0.4.2" }
    Dispatch->>ContribCI: trigger release workflow
    ContribCI->>ContribCI: mr fetch --only livestore --apply
    ContribCI->>ContribCI: stamp contrib packages at 0.4.2
    ContribCI->>ContribCI: rewrite workspace:* → 0.4.2 in publish manifests
    ContribCI->>npm: publish @livestore/{svelte, solid, cli, ...}@0.4.2
```

Manual contrib releases are supported (a `workflow_dispatch` input
`version: "0.4.2"`) but expected to be rare — they correspond to fixing a
contrib-only regression discovered after core's release published.

## CI design

Both repos generate their `.github/workflows/ci.yml` from a genie projection
that calls effect-utils' CI builders. Contrib's projection imports core's
helpers via relative path (not `#mr/`, per A04):

```ts
// livestore-contrib/.github/workflows/ci.yml.genie.ts
import {
  bashShellDefaults,
  devenvShellDefaults,
  installNixStep,
  applyMegarepoLockStep,
  restorePnpmStateStep,
  /* ...atomic CI steps re-exported from livestore/genie/repo.ts... */
} from '../../genie/repo.ts'

import { githubWorkflow } from '../../genie/repo.ts'

const contribCachixName = 'livestore-contrib'
const contribPnpmStateKey = 'livestore-contrib-pnpm-state-v1'

export default githubWorkflow({
  /* ...compose using the same steps, but with contrib-scoped identifiers */
})
```

`livestore-contrib/genie/repo.ts` is a thin module that re-exports from
`../repos/livestore/genie/repo.ts` and adds contrib-specific symbols (the
`contribCatalog`, contrib-only refs, etc.).

The full CI matrix (per-package lint, type-check, build, test) is reproduced
identically in both repos. The contrib matrix iterates over the contrib
package set; the core matrix iterates over the core package set.

## Docs site composition (Approach A′)

Single docs site at `docs.livestore.dev`, built from
`livestorejs/livestore/docs/`.

```
livestore/megarepo.lock:
  livestore-contrib:
    ref:    main
    pinned: false        ← critical: avoids lock-ratchet (R05)
    commit: <head-at-fetch-time>
    lockedAt: <…>

livestore/docs/astro.config.ts:
  starlightTypeDoc({
    entryPoints: [
      'packages/@livestore/react/src/index.ts',          // core
      'repos/livestore-contrib/packages/@livestore/svelte/src/index.ts',
      'repos/livestore-contrib/packages/@livestore/sync-electric/src/index.ts',
      …
    ],
  })

livestore/docs/src/content/docs/:
  framework-integrations/svelte-integration.mdx        ← stays in core (T04)
  platform-adapters/node-adapter.mdx                   ← stays in core (T04)
  sync-providers/electricsql.mdx                       ← stays in core (T04)
  …
```

Pre-build invocation, run by both `dt docs:dev` and the docs CI job:

```
mr fetch --only livestore-contrib --apply
```

After this command, `repos/livestore-contrib/` resolves through to a real
checkout. Astro/Starlight, Vite, and TypeDoc all read paths transparently
through the symlink (proven in derisking).

The end-state (contrib owns its docs source) is deferred to a follow-up
migration; see #1265 for the tracked task.

## Issue and PR routing

| Concern | Repo to file in |
|---|---|
| Core engine / sync-cf / adapter-web / adapter-cloudflare / react bug | livestore |
| Contrib package (svelte, solid, expo, electric, s2, cli, …) bug | livestore-contrib |
| Cross-repo coordination (releases, version bumps, the split itself) | livestore (epic #1265) |
| Docs site infrastructure (build, theming) | livestore |
| Docs content for a specific contrib package | livestore (during T04 window), livestore-contrib (after migration) |

Migrated open issues at split time:
- Label-driven enumeration: issues with `adapter:expo`, `adapter:node`,
  `integration:svelte`, `integration:solid`, `syncing:electric`,
  `syncing:s2`, `cli`, `devtools` get transferred via `gh issue transfer`.
- A small number with mixed scope require manual triage (per the
  open-PR audit in #1265).

## Genie composition mechanics

The single most important constraint (from A04): `#mr/<member>/...` does not
chase nested megarepo boundaries. A file in contrib that says
`from '#mr/livestore/genie/repo.ts'` will fail to resolve, because the
`#mr/effect-utils/...` imports inside that file are then attempted from
contrib's root, where `repos/effect-utils/` does not exist.

The mechanism that does work:

1. Contrib's `genie/repo.ts` imports from `../repos/livestore/genie/repo.ts`
   via **relative path**. Bun resolves the symlink and reads livestore's
   actual file.
2. Inside livestore's `genie/repo.ts`, `#mr/effect-utils/...` imports
   resolve against livestore's own megarepo root, where
   `repos/effect-utils/` exists. Resolution succeeds.

So contrib gets effect-utils' helpers transitively via livestore, without
having to know about effect-utils itself. Contrib's own `megarepo.lock` does
list effect-utils as a member (for parallel direct access if needed), but
the transitive chain through livestore is what enables genie reuse without
duplication.

Prep PR (tracked in #1265): livestore's `genie/repo.ts` needs to re-export
the constituent CI step atoms (`installNixStep`, `applyMegarepoLockStep`,
`restorePnpmStateStep`, etc.) so contrib can compose its own CI setup
without taking the `livestoreSetupSteps` composite (which hardcodes
`cachix.name = "livestore"` and the pnpm state key prefix).

## Open design questions

- **DQ1: TypeDoc for contrib packages at runtime.** When core's docs build
  runs `starlightTypeDoc` against
  `repos/livestore-contrib/packages/@livestore/svelte/src/index.ts`,
  does TypeDoc correctly resolve the package's own `tsconfig.json`?
  Verified during derisking that the file path resolves; not yet verified
  that TypeDoc's project-reference resolution works through the symlink at
  build time. Resolves by experiment during bootstrap PR.

- **DQ2: First-release dry-run.** The lockstep release flow has not been
  exercised end-to-end. The first contrib release after bootstrap will be
  the test. Plan: cut a `0.4.1-rc.0` from contrib after bootstrap, observe
  the manifest rewrite, then real release on `0.4.1`.

- **DQ3: Contrib docs source migration end-state.** T04 deferred the move
  from `livestore/docs/src/content/docs/` into
  `livestore-contrib/docs-content/`. The mechanism for that move (symlink
  mount + sidebar.ts composition vs. Astro Content Loader) needs its own
  small VRS pass when scheduled.
