---
title: Technology comparison
description: How LiveStore compares to other related technologies
sidebar:
  order: 25
---

## TLDR of what sets LiveStore apart

- Uses combination of reactive, in-memory + synced, persisted SQLite for instant, synchronous queries
- Based on event-sourcing methodologies
- Client-centric (with great devtools)

LiveStore is best compared along three categories: state-management
libraries, backend-as-a-service platforms, and local-first sync layers for
existing databases.

## State-management libraries

### LiveStore vs Redux

LiveStore shares a lot of similarities with Redux in that sense that both are based on event-sourcing methodologies. Let's compare some of the core concepts:

- Redux actions are similar to LiveStore events: Both are used to describe "things that have happened"
- Redux views are similar to LiveStore's state (e.g. SQLite tables): Both are derived from the history of events/actions.
  - A major difference here is that LiveStore's state materialized as a SQLite database allows for a lot more flexibility via dynamic queries and aggregations vs Redux's static views.
- Redux reducers are similar to LiveStore's materializers: Both are used to transform events/actions into a final state.
- Both Redux and LiveStore are client-centric.
- Both Redux and LiveStore provide powerful [devtools](/building-with-livestore/devtools).

While LiveStore can be used for the same use cases as Redux, LiveStore goes far beyond Redux in the following ways:

- LiveStore leverages SQLite for a more powerful state model allowing for flexible queries and aggregations with much simpler materialization logic.
- LiveStore supports client-persistence out of the box.
- LiveStore comes with a built-in [sync engine](/building-with-livestore/syncing) syncing events between clients.

As a downside compared to Redux, LiveStore has a slightly larger bundle size.

### Other state-management libraries

Zustand, Redux Toolkit (RTK), MobX, Jotai, XState, Recoil, and TanStack
Query solve in-memory state management (or server-cache management) but not
persistence, offline support, or cross-client syncing. The same comparison
as with Redux applies: with LiveStore, state lives in SQLite, is derived
from an eventlog, and syncs between clients out of the box.

## Backend-as-a-service (Firebase, Supabase, ...)

These platforms provide syncing but treat the server as the source of truth:

- Reads require network round-trips (or an additional caching layer)
- Offline support is limited or requires significant extra work
- You adopt their data model and pricing

LiveStore is client-centric: queries run synchronously against the local
SQLite database, apps work fully offline, and events sync via a pluggable
[sync provider](/sync-providers/custom) of your choice.

## Local-first sync for existing databases (ElectricSQL, Zero, PowerSync)

These technologies sync an existing database (usually Postgres) to clients
and are a great choice when that database is — and should remain — your
source of truth. LiveStore instead assumes a new app where the eventlog is
the source of truth from day one:

- Choose them when you need to keep an existing server database
  authoritative.
- Choose LiveStore when you want event-sourcing semantics (not just
  row-level sync) and the flexibility to materialize state in different
  ways.

## Other local-first/syncing technologies

To compare LiveStore with other local-first/syncing technologies, please see the [Local-First Landscape](https://www.localfirst.fm/landscape) resource.
