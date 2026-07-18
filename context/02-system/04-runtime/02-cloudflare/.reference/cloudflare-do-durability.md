# Cloudflare Durable Object Durability — Reference

Retrieved: 2026-07-15

Captures the Cloudflare platform durability guarantees the
`adapter-cloudflare` commit/recovery path depends on (cited from
LS.SYS.RT.CF-DQ1). Scope is SQLite-backed Durable Object storage
(`ctx.storage`, `ctx.storage.sql`) — the backend the adapter uses.
Every claim below cites official Cloudflare documentation; anything not
citable is listed under Unverified assumptions.

Sources (all developers.cloudflare.com, retrieved 2026-07-15):

- SQLITE-API: <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>
- LIFECYCLE: <https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/>

## Guarantees

- **Output gate holds outbound messages until the write completes.**
  "When a storage write operation is in progress, any new outgoing
  network messages will be held back until the write has completed. We
  say that these messages are waiting for the 'output gate' to open. If
  the write ultimately fails, the outgoing network messages will be
  discarded and replaced with errors, while the Durable Object will be
  shut down and restarted from scratch." The statement is scoped to "a
  storage write operation" generally, so it covers SQL writes.
  [SQLITE-API]

- **Confirmation is gated on disk flush.** On the `put()`/`delete()`/
  `deleteAll()` options: "By default, the system will pause outgoing
  network messages from the Durable Object until all previous writes
  have been confirmed flushed to disk. If the write fails, the system
  will reset the Object, discard all outgoing messages, and respond to
  any clients with errors instead." Rationale given: "it is impossible
  for any external party to observe the Object's actions unless the
  write actually succeeds." `allowUnconfirmed: true` opts out. (This
  text is on the KV `put()` surface; the general output-gate statement
  above is the runtime-level mechanism that also covers SQL.)
  [SQLITE-API]

- **Writes buffer in memory and flush asynchronously.** "put() writes
  to an in-memory write buffer that is flushed to disk asynchronously."
  `sync()` "Synchronizes any pending writes to disk … If there are any
  pending writes in the write buffer (including those submitted with the
  allowUnconfirmed option), the returned promise will resolve when they
  complete." So a write's promise resolving is not by itself proof the
  bytes are on disk; the output gate, not the promise, is what defers
  network observability until flush. [SQLITE-API]

- **SQL writes are transactional and atomic.** `sql.exec()` completes
  synchronously. `sql.exec()` "cannot execute transaction-related
  statements like BEGIN TRANSACTION or SAVEPOINT"; use
  `ctx.storage.transaction()` / `transactionSync()` — the latter
  "Invokes callback() wrapped in a transaction … If callback() throws …
  the transaction will be rolled back" and "must complete
  synchronously." Any `ctx.storage` operation, "including SQL queries
  using ctx.storage.sql.exec(), will be considered part of the
  transaction." Individual storage methods are "implicitly wrapped
  inside a transaction, such that its results are atomic and isolated
  from all other storage operations." Multiple `put()`/`delete()` calls
  "without performing any await in the meantime" are "automatically be
  combined and submitted atomically." [SQLITE-API]

- **Storage survives eviction; in-memory state does not.** "When
  hibernated, the in-memory state is discarded, so ensure you persist
  all important information in the Durable Object's storage." Hibernation
  occurs "after 10 seconds of inactivity"; eviction "after 70-140
  seconds of inactivity … the Durable Object will be evicted entirely
  from memory." On the next request "the constructor() will run again"
  and the object reactivates. [LIFECYCLE]

- **Point-in-time recovery, 30 days.** The PITR API "can restore a
  Durable Object's embedded SQLite database contents (both SQL data and
  key-value data) to any point in the past 30 days." [SQLITE-API]

## Implications for LiveStore

The DO adapter (`create-store-do.ts`) colocates the leader and single
client session in one isolate. Commits materialize and persist to the
eventlog via `ctx.storage` (SQL VFS) before the background push to the
sync backend. The push target `syncBackendStub` is a
`DurableObjectStub` (DO-to-DO RPC), i.e. an **outgoing network
message**.

- **No push precedes durable persistence.** Because the push is a
  network message, the output gate holds it until the eventlog write
  completes/flushes to disk. So no externally observable commit
  confirmation that leaves the isolate over the network — the push RPC,
  or a browser-facing WebSocket message — can precede the durable
  eventlog write. If the write fails, the runtime resets the object and
  replaces outbound messages with errors, so a failed write cannot be
  silently confirmed downstream.

- **Recovery re-derives from storage.** On eviction/crash the isolate's
  in-memory state is discarded, but the eventlog lives in `ctx.storage`
  and survives. The next request reboots the leader, which re-derives
  upstream head and pending events from DO storage and re-pushes pending
  events (spec Eviction/Resume; ../spec.md Leadership Handover).

- **Accepted commit-loss window.** The output gate only defers *network*
  output. The client session is colocated in-process
  (`ClientSessionLeaderThreadProxy`), so an ack to it is not a network
  message and is not gated by disk flush. Therefore the accepted
  commit-loss window is: progress committed into the in-isolate write
  buffer and acknowledged only to the colocated session, but not yet
  flushed to disk, when the isolate is abruptly terminated. Such
  progress is lost and recovered on next boot only to the extent it was
  flushed. It is never externally observable over the network, because
  any outbound network message reflecting it would itself have been
  output-gated on the flush.

## Unverified assumptions

Not stated on the pages above; these remain platform-trust:

- **Physical meaning of "flushed to disk" / "confirmed flushed."**
  Whether the flush the output gate waits on is to replicated or
  geo-durable storage, or to a single node's disk before the gate
  opens, is not documented. Durability against datacenter/hardware loss
  of already-flushed data is not specified here beyond PITR's 30-day
  recovery (a snapshot mechanism, not a synchronous-replication
  guarantee).

- **Flush latency.** The interval between a write's promise resolving
  and the bytes reaching disk is only described as "asynchronously"; no
  bound is given.

- **In-process observation of unflushed writes.** The output gate is
  documented as gating *network* output only. That an in-isolate
  continuation (e.g. the in-process session ack) can observe
  buffered-but-unflushed writes via read-your-writes is inferred from
  the network-scoped wording, not stated as a durability boundary.
