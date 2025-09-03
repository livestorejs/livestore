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
  - Identified by a `clientId` - a randomly generated 6-char nanoid
  - Each client has at least one client session
  - Sessions within a client share local data
  - Client session
    - An instance within a client
    - Identified by a `sessionId`
    - In web: sessionId can persist across tab reloads
    - Multiple sessions can exist within a single client (e.g., multiple browser tabs)
    - Store
    - Reactivity graph
- [Devtools](/reference/devtools)
- [Events](/reference/events)
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
    - [Event definitions](/reference/events)
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
- [Store](/reference/store)
  - A store exposes most of LiveStore's functionality to the application layer and is the main entry point for using LiveStore.
  - To create a store you need to provide a schema and a platform adapter which creates a client session.
  - A store is often created, managed and accessed through a framework integration (like React).
  - A store is identified by a `storeId` which is also used for syncing events between clients.
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

## Important Notes on Identity

- LiveStore does not have built-in concepts of "users" or "devices"
- User identity must be modeled within your application domain through events and application logic
- The `clientId` identifies a client instance, not a user
- Multiple clients can represent the same user (e.g., different browsers or devices)

