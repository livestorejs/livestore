---
title: Concepts
description: Concepts in LiveStore
sidebar:
  order: 15
---

![](https://share.cleanshot.com/sv62BGww+)

The core mental model: your app commits **events**, the **eventlog** orders
them, **materializers** derive **state** (SQLite) from them, and **live
queries** keep your UI in sync with that state.

## Events

- [Event](/building-with-livestore/events): an immutable record of a domain
  fact (e.g. `todoCreated`), committed to a store and appended to its
  eventlog.
  - Event definition: the schema declaring an event type (name, payload
    schema, sync scope).
  - Synced vs client-only events: synced events are distributed to other
    clients of the same store; client-only events never leave the committing
    client.
- Eventlog: the append-only, ordered log of committed events for one store —
  the source of truth all state derives from.

## State

- [State](/building-with-livestore/state/sqlite-schema): data derived from
  the eventlog via materializers and queryable by the app.
  - Materializer: a function that maps an event (and current state) to state
    changes; it runs identically on every client, so the same eventlog
    always produces the same state.
  - SQLite state / database:
    - In-memory SQLite database within the client session thread (usually
      the main thread), used by the reactivity graph for synchronous
      queries.
    - Persisted SQLite database (usually running on the leader thread).
    - Fully derived from the eventlog — it can always be rebuilt.
  - Client documents: a keyed document table shape for client-local/UI state
    with last-write-wins semantics.

## Store

- [Store](/building-with-livestore/store): the main entry point for using
  LiveStore — it bundles the eventlog, state, and reactivity for one store.
  - Identified by a `storeId`, which also partitions data and sync scope
    (one eventlog per `storeId`).
  - Usually created, managed, and accessed through a framework integration
    (like React).
- [Reactivity system](/building-with-livestore/reactivity-system): the
  incremental computation graph that keeps live queries up to date.
  - Db queries `queryDb()`
  - Computed queries `computed()`
  - Signals `signal()`

## Clients and sessions

- Client: a logical group of client sessions on one device/runtime that
  share local data; identified by a randomly generated `clientId`.
- Client session: one running instance within a client (e.g. a browser tab);
  identified by a `sessionId` (in web, it persists across tab reloads). Each
  session hosts a store and its reactivity graph.

## Syncing

- [Sync provider](/sync-providers/custom): a package that provides a sync
  backend plus the client transport to reach it.
  - Sync backend: the central service that orders and distributes synced
    events for a store.
- Events committed while offline are pending until the backend confirms
  them; local pending events are rebased on top of newly pulled upstream
  events (see [syncing](/building-with-livestore/syncing)).

## Schema

- LiveStore uses schema definitions for the following cases:
  - [Event definitions](/building-with-livestore/events)
  - [SQLite state schema](/building-with-livestore/state/sqlite-schema)
  - [Query result schemas](/building-with-livestore/state/sql-queries)
- LiveStore uses the [Effect Schema module](/patterns/effect) to define fine-granular schemas

### Implementation details

- Leader thread: the per-client role that owns persistence and syncing;
  exactly one leader is active per client at a time.
- Sync processors reconcile local pending events with upstream events — one
  runs session-side and one leader-side.

## Pluggable architecture

LiveStore is designed to be pluggable in various ways:

- Platform adapters (instantiate client sessions and the leader for a given
  platform, e.g. web, Expo)
- Sync providers
- Framework integrations (e.g. React, Solid, Svelte)

## Important notes on identity

- LiveStore does not have built-in concepts of "users" or "devices"
- User identity must be modeled within your application domain through events and application logic
- The `clientId` identifies a client instance, not a user
- Multiple clients can represent the same user (e.g., different browsers or devices)

For a walkthrough of how these pieces work together, see
[How LiveStore works](/overview/how-livestore-works).
