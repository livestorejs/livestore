---
title: Design decisions
description: Design decisions and trade-offs made in the development of LiveStore
sidebar:
  order: 10
---

This page summarizes LiveStore's major design decisions. The full decision
records — including the alternatives that were considered and rejected —
live in the repository's [intent layer](https://github.com/livestorejs/livestore/tree/main/context).

## Goals

- Fast, synchronous, transactional, and reactive state management
- Global state is eventually consistent
- Persistent storage
- Syncing
- Convenient schema migrations
- Great devtools

## Major design decisions

- **Event sourcing with read/write-model separation** is the foundational
  model: an append-only log of events is the source of truth, and all
  queryable state derives from it — so evolving the read model never
  requires migrating source data.
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/.decisions/0001-event-sourcing-foundation.md),
  [event sourcing](/understanding-livestore/event-sourcing))
- **SQLite is the primary read model** — a real database rather than a
  cache: synchronous reads with full SQL power. Further read-model
  realizations (including plain JavaScript structures) are a planned
  direction behind the same contract.
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/02-state/01-sqlite/.decisions/0001-sqlite-primary-read-model.md))
- **An in-memory SQLite database runs in each client session** (usually the
  main thread) so queries are synchronous, while a persisted database lives
  with the leader in a separate thread. This costs some memory per tab and
  assumes app data fits in memory.
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/04-runtime/.decisions/0001-in-memory-session-db.md))
- **One leader per client owns persistence and sync**; browser tabs and
  other sessions hold in-memory mirrors and talk to the leader through a
  proxy. Multi-tab consistency becomes a leader-election problem instead of
  a write-conflict problem.
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/04-runtime/.decisions/0002-leader-session-worker-split.md))
- **Reactivity is a signals-based eager graph** built on the ideas of
  Adapton for incremental computation — refreshed synchronously in
  topological order with equality cutoff (lazy recomputation is
  deliberately not implemented).
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/05-store/01-reactivity/.decisions/0001-eager-adapton-reactivity.md))
- **Conflicts resolve by deterministic total-order rebase**: the sync
  backend arbitrates one event order, clients rebase and replay — the same
  events always produce the same state. Richer conflict semantics are an
  active design direction (see the
  [command replay RFC](https://github.com/livestorejs/livestore/blob/main/contributor-docs/rfcs/0002-command-replay.md)).
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/03-sync/01-syncstate/.decisions/0001-total-order-rebase-default.md))
- **Devtools are protocol-first**: all inspection and control flows through
  a versioned message protocol, so the separately shipped devtools UI
  tolerates version skew and holds no privileged access to engine
  internals.
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/07-devtools/.decisions/0001-protocol-first-devtools.md))
- **Sync-provider agnostic**: the sync backend is a contract with multiple
  realizations so you can use the right provider for your use case (see
  [sync provider contract](https://github.com/livestorejs/livestore/blob/main/context/02-system/03-sync/spec.md)).
- **Deliberately minimal scope**: LiveStore stays focused on core data
  management and syncing, leaving authentication, file uploads, and
  business logic to application code — a composable, Unix-like building
  block.

## Implementation decisions

- Build most of the library in TypeScript; parts may move to Rust in the
  future.
- Embrace [Effect](https://effect.website) as a library of powerful
  primitives, particularly for the IO/concurrency-heavy parts.
  ([decision record](https://github.com/livestorejs/livestore/blob/main/context/02-system/.decisions/0002-typescript-effect-substrate.md))

## Original motivation

- Frustration with database schema migrations → event sourcing to separate
  read and write models (no schema migrations for the read model).
- Applying the "make the right thing easy" principle to app data
  management.
