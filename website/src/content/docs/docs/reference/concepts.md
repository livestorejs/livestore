---
title: Concepts
description: Concepts in LiveStore
sidebar:
  order: 1
---

## Overview

- Adapter (platform adapter)
  - An adapter can instantiate a client session for a given platform (e.g. web, Expo)
- Client
  - A logical group of client sessions
  - client only: tables / mutations are are only available to the client and not synced across clients
- Client session
  - Store
  - Reactivity graph
  - Responsible for leader election
- Leader thread
  - Responsible for syncing and persisting of data
- SQLite database
  - In-memory SQLite database within the client session thread (usually main thread)
    - Used by the reactivity graph
  - Persisted SQLite database (usually running on the leader thread)
  - Fully derived from the mutation eventlog
- Live queries
  - Db queries `queryDb()`
  - Computed queries `computed()`
- Events
  - Event definition
  - Event
  - Eventlog
- Devtools
- Sync backend
  - A central server that is responsible for syncing the mutation eventlog between clients
- Framework integration
  - A framework integration is a package that provides a way to integrate LiveStore with a framework (e.g. React, Solid, Svelte, etc.)

### Implementation details

- Sync processor
  - LeaderSyncProcessor
  - ClientSessionSyncProcessor

## Architecture diagram

Assuming the web adapter in a multi-client, multi-tab browser application, a diagram looks like this:

![](https://i.imgur.com/NCKbfub.png)

The architecture is similar for other adapters (e.g. Expo) but often only involves a single client session per client.