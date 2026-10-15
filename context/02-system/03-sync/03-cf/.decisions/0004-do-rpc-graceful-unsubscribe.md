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

- **(a) Explicit unsubscribe on graceful client-done — chosen.** The live
  pull that registered the row also releases it: `SyncDoRpc.Unsubscribe` is
  sent from the live pull's release, which runs exactly when the store is
  explicitly shut down (`store.shutdown()` closes the enclosing scope).
  Best-effort (bounded timeout, swallowed) since a dropped send only reverts to
  the prior leak. The row is matched on the live pull's `requestId`, not just
  the `durableObjectId`: `store.shutdown()` returns to the caller after 1 s
  while the detached teardown may drain for up to 30 s, so a replacement store
  booted on the same client DO in that window overwrites the row with its own
  request id, and the earlier pull's late unsubscribe must be a no-op rather
  than take the replacement's subscription down. This mirrors the client-side
  routing map, which is keyed by request id for the same reason.
- **(b) Server-side reaping on silence/idle/TTL/failed delivery.** Rejected:
  reintroduces the 0003/#1462 regression — it cannot tell a hibernating client
  from a departed one, so it would drop rows a waking client still needs.

## Evidence

CF DO eviction destroys the isolate with no JS execution, so the finalizer runs
only on graceful shutdown, never on eviction. Two tests pin this
(`tests/sync-provider/src/do-rpc-unsubscribe.test.ts`): a graceful
`store.shutdown()` drops the subscription count to 0, while an evicted client
(idled past the eviction window; its DO `instanceId` changes) keeps its row at 1.
The request-id match is pinned by a unit test
(`cf-worker/do/transport/do-rpc-server.test.ts`): a superseded request id
leaves the row, the registering one drops it; the graceful-shutdown test above
also proves the client sends the matching id.
Implementation: `common/do-rpc-schema.ts` (`Unsubscribe`),
`cf-worker/do/transport/do-rpc-server.ts` (`dropRpcSubscription`),
`client/transport/do-rpc-client.ts` (finalizer in the live pull's scope).

## Consequences

- Graceful teardown is handled; the remaining leak is by design — a client DO
  that is evicted and never returns keeps its row, since the provider never
  reaps on silence (0003). Reaping a permanently-departed client is the
  consumer's concern; there is no safe silence-based signal.
- `Unsubscribe` deletes by a client-supplied `durableObjectId` plus
  `requestId`, matching the Pull handler's existing trust model
  (client-supplied `callerContext`); DO-RPC gives the callee no authenticated
  caller identity. The request-id match is a correctness guard against a
  client's own stale release, not an authentication step: the Pull handler still
  overwrites the row unconditionally. Deriving the id from the caller instead is
  deferred hardening work.
