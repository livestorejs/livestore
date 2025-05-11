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
- [Devtools](/reference/devtools)
- Events
  - Event definition
  - Eventlog
  - Synced vs client-only events
- Framework integration
  - A framework integration is a package that provides a way to integrate LiveStore with a framework (e.g. React, Solid, Svelte, etc.)
- [Reactivity system](/reference/reactivity-system)
  - Db queries `queryDb()`
  - Computed queries `computed()`
  - Signals `signal()`
- Schema
  - LiveStore uses schema definitions for the following cases:
    - [Event schema](/reference/events/events-schema)
    - [SQLite state schema](/reference/state/sqlite-schema)
    - [Query result schemas](/reference/state/sql-queries)
  - LiveStore uses the [Effect Schema module](/patterns/effect) to define fine-granular schemas
- State
  - Derived from the eventlog via materializers
  - Materializer
    - Event handler function that maps an event to a state change
  - SQLite state / database
    - In-memory SQLite database within the client session thread (usually main thread)
      - Used by the reactivity graph
    - Persisted SQLite database (usually running on the leader thread)
    - Fully derived from the eventlog
- Store
  - A store exposes most of LiveStore's functionality to the application layer and is the main entry point for using LiveStore.
  - To create a store you need to provide a schema and a platform adapter which creates a client session.
  - A store is often created, managed and accessed through a framework integration (like React).
- Sync provider
  - A sync provider is a package that provides a sync backend and a sync client.
  - Sync backend
    - A central server that is responsible for syncing the eventlog between clients

### Implementation details

- Leader thread
  - Responsible for syncing and persisting of data
- Sync processor
  - LeaderSyncProcessor
  - ClientSessionSyncProcessor

## Pluggable architecture

LiveStore is designed to be pluggable in various ways:

- Platform adapters
- Sync providers
- Framework integrations

