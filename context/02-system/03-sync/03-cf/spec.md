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
- **Push arbitration** (`cf-worker/do/push.ts`): Durable Object context
  initialization is single-flight, yielding one shared head reference and push
  semaphore per instance. Under that semaphore, accept iff
  `batch[0].parentSeqNum === currentHead` (else `ServerAheadError` with
  `minimumExpectedNum`), append client-supplied sequence numbers, advance
  `currentHead`, and publish the matching pull response before honoring
  interruption or admitting the next push. Persistence remains inside
  `ctx.blockConcurrencyWhile`; the larger admission-to-publication transition
  is serialized and uninterruptible. Empty batches short-circuit to an ack.
  There is no explicit idempotency/dedup beyond the head check (see
  [.decisions/0002-atomic-push-publication.md](./.decisions/0002-atomic-push-publication.md)).
- **Fan-out** (`push.ts`): accepted batches are re-chunked and emitted in
  admission order to two subscriber sets — hibernatable WebSockets (per-socket
  `pullRequestIds` attachments; hand-crafted RPC chunk frames) and DO-RPC
  subscriptions (a durable KV registry fed by live pulls).

  **Maturity: experimental.** A DO-RPC live pull passes a persistent callback
  stub minted with `ctx.restore({ storeId, subscriptionId })`. The backend
  stores it under `rpc-sub:<subscriptionId>`, re-derives its target on each
  publish, and disposes the loaded stub after delivery so neither DO stays
  pinned awake. The restored client target reloads an evicted store before
  routing the update. It returns `{ refused: true }` when the subscription is
  no longer current, which removes the backend row; graceful shutdown clears
  the client marker and also sends `Unsubscribe`. See
  [.decisions/0006-persistent-stub-subscriptions.md](./.decisions/0006-persistent-stub-subscriptions.md).
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
| HTTP | `http-rpc-schema.ts` | client-side polling (~5 s default) | 10 s hard request timeout; explicit `Ping` RPC |
| DO-RPC | `do-rpc-schema.ts` | persistent-stub callback queue (`live.subscriptionId` presence = live) | experimental; for same-Cloudflare-app callers (`adapter-cloudflare`); explicit `Ping` |

All three transports thread the client `payload` (per-connection auth/multi-tenancy
context) into the DO `onPush`/`onPull` callbacks.

Message payloads share `sync-message-types.ts`
(PullRequest/PullResponse/PushRequest/PushAck/Ping/Pong + unwired admin
messages). Wire messages are unversioned (LS.SYS.SYNC.CF-R03).

The two-phase pull shape (bounded history stream + per-transport liveness)
and the rejected long-lived streaming alternatives are recorded in
[.decisions/0001-transport-liveness-design.md](./.decisions/0001-transport-liveness-design.md).

Server-side embedding of a LiveStore client inside Cloudflare (Durable
Object hosting a store) is `04-runtime/`'s adapter concern
(`adapter-cloudflare`), not part of this provider node.

## Optional telemetry

The existing `makeDurableObject` option `otel` accepts either an Effect tracer
layer or a `{ baseUrl, serviceName? }` endpoint configuration. The latter creates
an Effect OTLP exporter layer. Omit `otel` to avoid creating an exporter or sending telemetry.
Applications choose the integration and destination; no Cloudflare-specific
tracer package or paid feature is required by the library.

LiveStore builds the layer in a fresh scope per sync operation. Construction runs
on the operation path; resource finalization runs in the background so export
cleanup cannot delay acknowledgments or change sync outcomes. The layer defines
its exporter lifecycle. LiveStore does not manage SDK providers or schedule their
`forceFlush()` calls. A supplied layer must not shut down a shared provider.
The built-in endpoint exporter uses Effect's three-second shutdown timeout.

WebSocket pushes and finite pull history receive exported RPC boundary spans
attached directly to a sampled caller, bypassing Effect RPC's unexported
subscription envelope. When the caller has no sampled context, the boundary
starts a backend root so server-side telemetry remains independently observable.
Expected `ServerAheadError` and `BackendIdMismatchError` recovery results remain
typed failures without marking these RPC boundaries as OpenTelemetry errors.
DO-RPC pull streams receive tracing inside their separate execution runtime.
Finite history closes before waiting for live updates, so the endpoint exporter
does not retain timers for the lifetime of an idle subscription.

Delivery remains best-effort: Durable Objects have no shutdown callback on
hibernation or eviction. This integration does not join Cloudflare-native trace
IDs to external traces or change the sync protocol. See
[decision 0005](.decisions/0005-optional-telemetry-ownership.md).

## Known Gaps (Non-Obligations)

Current reality a consumer must not read as guaranteed behavior:

- **Persistent-stub API stability.** DO-RPC live pull depends on Cloudflare's
  undocumented `ctx.restore` persistent-stub surface and the
  `allow_irrevocable_stub_storage` compatibility flag on both Workers. Its
  stable support and cross-redeploy guarantees are not yet documented upstream.
- **WebSocket interrupt completion.** WS `Interrupt` still emits no Exit
  (`cf-worker/durable-object.ts`; issue #1418).
- **Admin RPCs are defined but unwired** in all three transports
  (`AdminResetRoom`/`AdminInfo`).
- **No head↔eventlog consistency check at load** (`layer.ts:96`), and
  `resetStore` wipes all DO storage via `deleteAll`
  (`sync-storage.ts:206`).
