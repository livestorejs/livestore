---
title: SQLite in LiveStore
description: Notes on how to use SQLite in LiveStore
sidebar:
  order: 21
---

LiveStore heavily uses SQLite as its default state/read model.

## Implementation notes

- LiveStore relies on the following SQLite extensions to be available: `-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK`
  - [bytecode](https://www.sqlite.org/bytecodevtab.html)
  - [session](https://www.sqlite.org/sessionintro.html) (incl. preupdate)

- For web / node adapter:
  - LiveStore uses [a fork](https://github.com/livestorejs/wa-sqlite) of the [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) SQLite WASM library.
  - Write‑ahead logging (WAL) is currently not supported/enabled for the web adapter using OPFS (AccessHandlePoolVFS). The underlying VFS does not support WAL reliably in this setup; we disable it until it’s safe to use. See our tracking issue and upstream notes:
    - LiveStore: https://github.com/livestorejs/livestore/issues/258
    - wa‑sqlite examples (comparison table shows WAL unsupported for AccessHandlePoolVFS): https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/README.md
    - Related discussion on single‑connection OPFS and locking: https://github.com/rhashimoto/wa-sqlite/discussions/81
  - In the future LiveStore might use a non‑WASM build for Node/Bun/Deno/etc.
- For Expo adapter:
  - LiveStore uses the official expo-sqlite library which supports LiveStore's SQLite requirements.

- LiveStore uses the `session` extension to enable efficient database rollback which is needed when the eventlog is rolled back as part of a rebase. An alternative implementation strategy would be to rely on snapshotting (i.e. periodically create database snapshots and roll back to the latest snapshot + applied missing mutations).

## Default tables

LiveStore operates two SQLite databases by default: a state database (your materialized tables) and an event log database (the immutable event stream and sync metadata). In addition to your own application tables, LiveStore creates a small set of internal tables in each database.

### State database

- `__livestore_schema`
  - Tracks the schema hash and last update time per materialized table. Used for migrations and compatibility checks.
- `__livestore_schema_event_defs`
  - Tracks the schema hash and last update time per event definition. Used to detect incompatible event schema changes during rematerialization.
- `__livestore_session_changeset`
  - Stores SQLite session changeset blobs keyed by event sequence numbers. Used to efficiently roll back and re‑apply state during rebases.
- Your application tables
  - All tables you define via `State.SQLite.table(...)` live in the state database.

### Eventlog database

- `eventlog`
  - Append‑only table containing all events (sequence numbers, parent links, event name, encoded args, client/session IDs, schema hash, optional sync metadata). Used to reconstruct state and for sync.
- `__livestore_sync_status`
  - Stores the current head and optional backend identity for synchronization bookkeeping.

Note: The event log database’s use of SQLite is an implementation detail. It is not a public interface and is not intended for direct reads or writes. Query state via your materialized tables and LiveStore APIs; do not depend on the event log database layout or mutate it directly.
