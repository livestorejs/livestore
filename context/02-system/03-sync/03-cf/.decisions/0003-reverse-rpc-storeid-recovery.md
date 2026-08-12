# 0003 — Reverse-RPC carries storeId so reconstructed client DOs recover live updates

Status: accepted (recorded 2026-08-08).

## Context

0001 chose per-transport liveness so isolates can hibernate between events,
and accepted (Consequences) that "hibernated-client delivery gaps become
possible on DO-RPC (#1415) — the price of not pinning the client DO awake."
In practice the gap was broader than a hibernation edge case: the DO-RPC
reverse call (`syncUpdateRpc`) is itself the wake, so after eviction it
always lands on a freshly reconstructed, store-less client DO. With no store
in memory the update was logged and dropped. The reverse-RPC did not carry
enough to recover — the client received only the payload, and the DO id is a
one-way `idFromName(storeId)`, so the storeId could not be recovered locally.

## Options

- **(a) Thread `storeId` through the reverse-RPC — chosen.** The fan-out
  already knows each subscription's `storeId`; pass it into
  `emitStreamResponse` and on to the client's `syncUpdateRpc(payload, storeId)`
  as a required trailing argument. A store-less wake can then re-boot its
  store (boot runs a catch-up pull)
  before delivering. Recovery stays the client/adapter's choice (eager
  re-boot vs lazy), keeping the provider mechanism-only.
- **(b) Persist the storeId in the client DO.** Rejected: redundant — the DO
  id is already `idFromName(storeId)`, so the storeId is invariant per DO and
  can travel on the call itself; persisting adds a storage round-trip and a
  second source of truth.
- **(c) Pin the client DO awake to keep the pull queue alive.** Rejected:
  reintroduces exactly the CPU-billing cost 0001 avoided.

## Evidence

Reproduced live on `examples/web-email-client` against a pristine baseline
(fix removed, local DO state wiped, fresh client): after DO eviction a
reverse-RPC push threw `Store not initialized` from `emitStreamResponse` →
the client's `syncUpdateRpc`, and the cross-store update never reached the
mailbox projection. With the fix in place the reconstruction test
(`tests/sync-provider/src/do-rpc-client-reconstruction.test.ts`) asserts a
reconstructed client materializes both pre- and post-reconstruction events.
Implementation: `common-cf/src/do-rpc/server.ts` (interface +
`emitStreamResponse`) and `sync-cf/src/cf-worker/do/push.ts`
(`subscription.storeId` fan-out).

## Consequences

- Supersedes 0001's accepted #1415 consequence: DO-RPC live delivery now
  survives client-DO reconstruction for eager clients, without pinning the DO
  awake — hibernation-to-$0 is preserved.
- `syncUpdateRpc` gains a required trailing `storeId` parameter. The backend
  always supplies it (it is a required field on the subscription record), so an
  eager client can rely on its presence instead of guarding a case that cannot
  occur. Requiring it stays non-breaking: implementors that ignore recovery may
  still declare a one-arg `syncUpdateRpc(payload)` (fewer parameters remain
  assignable to the interface), and the sole caller already passes it.
- Client-side recovery (re-boot + catch-up, or lazy opt-out) is the
  `04-runtime` adapter's concern; see that node's spec §Eviction and Resume.
