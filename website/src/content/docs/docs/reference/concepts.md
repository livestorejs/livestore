---
title: Concepts
description: Concepts in LiveStore
sidebar:
  order: 1
---

![](https://share.cleanshot.com/sv62BGww+)

## Overview

- Adapter (platform adapter)
  - An adapter can instantiate a client session for a given platform (e.g. web, Expo)
- Client
  - A logical group of client sessions
- Client session
  - Store
  - Reactivity graph
  - Responsible for leader election
- [Devtools](/docs/reference/devtools)
- Materializer
  - Event handler function that maps an event to a state change
- Live queries
  - Db queries `queryDb()`
  - Computed queries `computed()`
- Events
  - Event definition
  - Eventlog
  - Synced vs client-only events
- Schema
  - LiveStore uses schema definitions for the following cases:
    - [Event schema](/docs/reference/events/events-schema)
    - [SQLite state schema](/docs/reference/state/sqlite-schema)
    - [Query result schemas](/docs/reference/state/sql-queries)
  - LiveStore uses the [Effect Schema module](/docs/patterns/effect) to define fine-granular schemas
- State
  - Derived from the eventlog via materializers
  - SQLite state / database
    - In-memory SQLite database within the client session thread (usually main thread)
      - Used by the reactivity graph
    - Persisted SQLite database (usually running on the leader thread)
    - Fully derived from the eventlog
- Sync backend
  - A central server that is responsible for syncing the eventlog between clients
- Framework integration
  - A framework integration is a package that provides a way to integrate LiveStore with a framework (e.g. React, Solid, Svelte, etc.)

### Implementation details

- Leader thread
  - Responsible for syncing and persisting of data
- Sync processor
  - LeaderSyncProcessor
  - ClientSessionSyncProcessor

## Architecture diagram

Assuming the web adapter in a multi-client, multi-tab browser application, a diagram looks like this:

![](https://i.imgur.com/NCKbfub.png)

The architecture is similar for other adapters (e.g. Expo) but often only involves a single client session per client.

## Pluggable architecture

LiveStore is pluggable in 3 ways:

- Platform adapters
- Sync backends
- Framework integrations

