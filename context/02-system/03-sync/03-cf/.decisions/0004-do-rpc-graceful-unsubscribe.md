# 0004 — DO-RPC clients unsubscribe on graceful shutdown; subscriptions are never reaped on silence

Status: accepted (recorded 2026-08-09).

## Context

0003 made a DO-RPC subscription deliberately survive client-DO eviction so a
reconstructed client recovers its live pull — the provider keeps delivering and
never drops a row on silence. That left the inverse unhandled: nothing ever tore
a subscription down. The server persists one `rpc-sub:<durableObjectId>` row per
subscribing client DO (Pull handler `put`), and it was never deleted, so a
client that finished with its store left the backend fanning out to (and waking)
it forever (#1418).

The binding constraint from 0003: teardown must never key off mere absence. A
hibernating client is silent and indistinguishable-by-silence from a departed
one; reaping its row would drop the echo it needs on wake (#1415/#1462).

## Options

- **(a) Explicit unsubscribe on graceful client-done — chosen.** The client
  sends `SyncDoRpc.Unsubscribe` from a finalizer on the sync-backend scope, so
  it runs exactly when the store is explicitly shut down (`store.shutdown()`
  closes that scope) and the server deletes the row. Registered after the
  RpcClient is built so it sends before the protocol tears down; best-effort
  (bounded timeout, swallowed) since a dropped send only reverts to the prior
  leak. Keyed by `durableObjectId`, so one delete covers any number of live
  pulls.
- **(b) Server-side reaping on silence/idle/TTL/failed delivery.** Rejected:
  reintroduces the 0003/#1462 regression — it cannot tell a hibernating client
  from a departed one, so it would drop rows a waking client still needs.

## Evidence

CF DO eviction destroys the isolate with no JS execution, so the finalizer runs
only on graceful shutdown, never on eviction. Two tests pin this
(`tests/sync-provider/src/do-rpc-unsubscribe.test.ts`): a graceful
`store.shutdown()` drops the subscription count to 0, while an evicted client
(idled past the eviction window; its DO `instanceId` changes) keeps its row at 1.
Implementation: `common/do-rpc-schema.ts` (`Unsubscribe`),
`cf-worker/do/transport/do-rpc-server.ts` (handler `kv.delete`),
`client/transport/do-rpc-client.ts` (backend-scope finalizer).

## Consequences

- Graceful teardown is handled; the remaining leak is by design — a client DO
  that is evicted and never returns keeps its row, since the provider never
  reaps on silence (0003). Reaping a permanently-departed client is the
  consumer's concern; there is no safe silence-based signal.
- `Unsubscribe` deletes by a client-supplied `durableObjectId`, matching the
  Pull handler's existing trust model (client-supplied `callerContext`); DO-RPC
  gives the callee no authenticated caller identity. Deriving the id from the
  caller instead is deferred hardening work.
