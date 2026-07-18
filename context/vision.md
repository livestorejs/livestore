# LiveStore — Vision

## The Problem

1. **Problem 1 — Fragmented data layer.** Building an app with great UX means
   solving state management, persistence, offline support, real-time sync, and
   conflict resolution. Each traditionally requires a separate tool; the tools
   don't compose, so every app grows its own fragile glue layer of optimistic
   updates, retry queues, and cache invalidation.

2. **Problem 2 — The cache mindset.** Most data layers treat local data as a
   cache of server state. Reads need the network (or loading states), offline
   is an afterthought, and the app inherits the full intricacy of cache
   consistency.

3. **Problem 3 — Syncing mutable state loses information.** Synchronizing
   state snapshots forces "who wins?" conflict decisions, records nothing
   about what actually happened, and makes concurrent edits a source of bugs
   instead of a normal condition.

4. **Problem 4 — Opaque data flow.** When state changes can't be inspected,
   audited, or replayed, debugging an app's data layer is guesswork.

5. **Problem 5 — Read-model migration pain.** When the storage schema is the
   source of truth, every change to how data is queried risks a migration of
   the source data itself.

## The Vision

- **One coherent model.** (Problem 1) A single data layer in which state,
  persistence, offline, and sync all fall out of one abstraction: an
  append-only log of domain events.
- **Local-first reads.** (Problem 2) A full-featured local database is the
  primary data source. Reads are synchronous; the server is a sync target,
  not the source of truth.
- **Histories, not snapshots.** (Problem 3) Syncing merges event histories
  instead of reconciling states. Every change is recorded; concurrent work
  converges deterministically.
- **Rebuildable state.** (Problem 5) All queryable state is derived from the
  log and can be rebuilt or reshaped at any time — evolving the read model
  does not require migrating source data.
- **Transparent by design.** (Problem 4) The data layer can show its work:
  inspect the log, watch state derive, replay history.
- **The same everywhere.** (Problem 1) One mental model across web, mobile,
  desktop, and server; platform- and ecosystem-specific layers stay thin.
- **A sustainable commons.** Community-owned open source, funded by sponsors,
  with no controlling company.

## What This Is Not

- Not a backend-as-a-service: no authentication, file storage, or hosted
  infrastructure.
- Not a sync layer for existing server-owned databases; it assumes the log is
  the source of truth from day one.
- Not a batteries-included full-stack framework; it stays a focused,
  composable data layer.
- Not built for datasets that exceed client capacity or for high-concurrency
  writes to a single shared log; scale comes from many small logs, not one
  big one.
- Not a beginner's first state library; it targets developers who have felt
  these problems.

## Success Criteria

1. A new app gets state, persistence, offline, and sync from one library with
   no custom glue between them.
2. Reads are served locally and synchronously, fast enough for 120fps-class
   interactive apps.
3. The same event history produces the same state on every client and
   platform.
4. Apps keep working offline indefinitely and converge after reconnecting.
5. Every state change can be inspected and replayed with first-class tooling.
6. Each pluggable seam (platforms, sync providers, frameworks, read models)
   has at least two independent realizations proving the contract.
7. The project sustains active maintenance through sponsorship alone.
