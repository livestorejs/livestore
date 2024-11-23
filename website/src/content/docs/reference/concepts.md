---
title: Concepts
description: Concepts in LiveStore
sidebar:
  order: 1
---

## Overview

- Adapter
  - An adapter can instantiate a client session for a given platform (e.g. web, Expo)
- Client
  - A logical group of client sessions
- Client session
  - Store
  - Reactivity graph
  - Coordinator
- SQLite database
  - In-memory SQLite database within the client session thread (usually main thread)
    - Used by the reactivity graph
  - Persisted SQLite database (usually running in a background thread/web worker)
  - Fully derived from the mutation eventlog
- Live queries
  - Db queries `queryDb()`
  - Computed queries `computed()`
- Mutation
  - Mutation definition
  - Mutation event
  - Mutation eventlog
- Devtools
- Sync backend
  - A central server that is responsible for syncing the mutation eventlog between clients

## Architecture diagram

Assuming the web adapter in a multi-client, multi-tab browser application, a diagram looks like this:

![](https://i.imgur.com/NCKbfub.png)

The architecture is similar for other adapters (e.g. Expo) but often only involves a single client session per client.