# Cloudflare Sync Provider — Spec

This document specifies the Cloudflare realization of the sync provider
contract. It builds on [requirements.md](./requirements.md); the contract
itself lives in the [parent spec](../spec.md).

## Status

Draft.

## Topology

```
client (SyncBackend impl, src/client/) ──ws | http | do-rpc──▶
  CF worker (src/cf-worker/worker.ts) ──▶ Durable Object per storeId
                                          (src/cf-worker/do/, ordered log)
```

One Durable Object instance per `storeId` (`idFromName(storeId)`)
arbitrates pushes and fans out live pull streams to subscribers
(LS.SYS.SYNC.CF-R01).

## Durable Object Internals

- **Storage engines** (`cf-worker/do/layer.ts:55-68`): DO-embedded SQLite
  (`do-sqlite`, default) or external D1 (`{_tag:'d1', binding}`). The
  `contextTable` always lives in DO SQLite even when the eventlog is on D1.
- **Tables** (`cf-worker/do/sqlite.ts`): `eventlog_<V>_<storeId>` — one row
  per global event (`seqNum` PK, `parentSeqNum`, `name`, `args` JSON,
  `createdAt` (debug-only, yet surfaced as `SyncMetadata`), `clientId`,
  `sessionId`); `context_<V>` — one row per store (`storeId` PK,
  `currentHead`, `backendId`). `<V>` = `PERSISTENCE_FORMAT_VERSION`
  (currently 7, `cf-worker/shared.ts:135`); bumping it renames the tables —
  a soft reset that orphans old data (LS.SYS.SYNC.CF-R03).
- **Push arbitration** (`cf-worker/do/push.ts:63-87`): inside
  `ctx.blockConcurrencyWhile`, accept iff
  `batch[0].parentSeqNum === currentHead` (else `ServerAheadError` with
  `minimumExpectedNum`), append client-supplied sequence numbers, advance
  `currentHead`. Empty batches short-circuit to an ack. There is no
  explicit idempotency/dedup beyond the head check (TODO `push.ts:65`).
- **Fan-out** (`push.ts:90-187`): after the serialized section, an
  uninterruptible background fiber re-chunks the batch and emits to two
  subscriber sets — hibernatable WebSockets (per-socket `pullRequestIds`
  attachments; hand-crafted RPC chunk frames) and DO-RPC subscriptions (an
  in-memory map fed by live pulls).
- **BackendId** (`layer.ts:98-114`): `nanoid()` on first context build,
  persisted in `contextTable`; pull/push carrying a different backendId
  fail with `BackendIdMismatchError` (client records it lazily from pull
  responses).
- **Limits** (`common/constants.ts`): `MAX_TRANSPORT_PAYLOAD_BYTES =
  900_000` (below the ~1 MB hibernated-WS frame cap),
  `MAX_PULL_EVENTS_PER_MESSAGE = MAX_PUSH_EVENTS_PER_REQUEST = 100`. D1
  paths additionally paginate adaptively (~1 MB response target, page size
  shrinking from 256) and chunk inserts to 14 events per statement
  (100-bound-param limit) (`cf-worker/do/sync-storage.ts:45-198`).

## Transports

| Transport | Schema | Liveness | Notes |
| --- | --- | --- | --- |
| WebSocket | `ws-rpc-schema.ts` | server-held stream (`live` flag + `Stream.never`), pushed chunks | default; DO auto ping/pong; hibernation-aware |
| HTTP | `http-rpc-schema.ts` | client-side polling (~5 s default) | 10 s hard request timeout; explicit `Ping` RPC; push `payload` not threaded (see gaps) |
| DO-RPC | `do-rpc-schema.ts` | RPC callback queue (`rpcContext` presence = live) | for same-Cloudflare-app callers (`adapter-cloudflare`); explicit `Ping` |

Message payloads share `sync-message-types.ts`
(PullRequest/PullResponse/PushRequest/PushAck/Ping/Pong + unwired admin
messages). Wire messages are unversioned (LS.SYS.SYNC.CF-R03).

Server-side embedding of a LiveStore client inside Cloudflare (Durable
Object hosting a store) is `04-runtime/`'s adapter concern
(`adapter-cloudflare`), not part of this provider node.

## Known Gaps (Non-Obligations)

Current reality a consumer must not read as guaranteed behavior; GitHub
issues pending:

- **Hibernated DO-RPC clients drop live updates.** When the client DO was
  hibernated, the pull-stream queue is gone and the update is only logged,
  not applied (`client/transport/do-rpc-client.ts:189-197`).
- **Cross-store subscription bleed risk.** The DO-RPC client's
  `requestIdQueueMap` is module-global with a scoping TODO
  (`do-rpc-client.ts:30`).
- **HTTP push drops `payload`.** The per-push payload (used for
  auth/multi-tenancy) is passed as `undefined` server-side over HTTP but
  threaded on WS/DO-RPC (`cf-worker/transport/http-rpc-server.ts:47`).
- **Live-subscriber leaks on abnormal disconnect.** WS `Interrupt` emits
  no Exit and DO-RPC `Interrupt` handling is a TODO
  (`cf-worker/durable-object.ts:136`, `cf-worker/do/pull.ts:19`).
- **Admin RPCs are defined but unwired** in all three transports
  (`AdminResetRoom`/`AdminInfo`).
- **No head↔eventlog consistency check at load** (`layer.ts:96`), and
  `resetStore` wipes all DO storage via `deleteAll`
  (`sync-storage.ts:206`).
