# 0006 — Use persistent stubs for DO-RPC live subscriptions

Status: accepted (recorded 2026-09-03). Evidence: PR #1602 edge lifecycle run
with 20 client Durable Objects, including eviction, reconstruction, graceful
shutdown, supersession, abort recovery, and fan-out.

## Context

Decisions 0003 and 0004 addressed reconstruction and graceful teardown while
the backend still identified a client by its self-reported binding name and
Durable Object id. That address never expires and is forgeable. The backend
therefore could not distinguish a departed subscriber from a hibernating one:
rows leaked, and every publish woke dead client addresses. Keeping an ordinary
RPC stub would avoid the forged address but pin both objects awake.

Cloudflare's persistent-stub API can store a stub as a capability and re-derive
its target on each call without keeping either Durable Object resident. The API
is live but undocumented and guarded by `allow_irrevocable_stub_storage` on the
storing Worker, target Worker, and every restore-chain member. Cloudflare calls
this flag temporary and inherently insecure across trust boundaries because the
target cannot audit or revoke the stored capability.

## Options

- **(a) Store one persistent callback stub per live pull — chosen.** The client
  mints `ctx.restore({ storeId, subscriptionId })`, records the subscription id
  as current for that store, and passes the stub as a native second argument to
  the backend RPC. The backend stores it under the subscription id. On publish,
  the restored target either delivers or explicitly refuses; refusal deletes
  the row. Both sides dispose every loaded stub after use.
- **(b) Continue reconstructing a client stub from binding name and DO id.**
  Rejected because the address is client-controlled, never expires, and gives
  the backend no reliable departure signal.
- **(c) Store an ordinary RPC stub.** Rejected because an undisposed live
  session keeps both Durable Objects awake and billed.
- **(d) Reap rows by silence or TTL.** Rejected because silence cannot
  distinguish hibernation from departure and would lose wake-up delivery.

## Consequences

- Supersedes 0003's address-based `syncUpdateRpc(payload, storeId)` contract
  and 0004's request-id-matched unsubscribe design. `storeId` and the unique
  subscription id now travel in authenticated restore parameters instead of a
  forgeable callback address.
- A restored client target checks the persisted active-subscription marker
  before and after its optional store-reload hook. If reload starts a newer
  pull, the callback that caused the wake refuses in the same publish.
- Graceful shutdown clears the marker before sending best-effort
  `Unsubscribe { subscriptionId }`. If unsubscribe is lost, the next delivery
  refuses and removes the row. A permanently departed client is likewise
  removed on the next publish rather than on silence.
- Refusal is a return value, not an exception. Cloudflare surfaces throws from
  `[restore]` as retryable connection loss, so using an exception would retain
  the stale row.
- Every minted or storage-loaded stub must be disposed after use. Failing to do
  so prevents hibernation.
- Workers with compatibility dates before 2026-01-20 enable
  `rpc_params_dup_stubs`, matching current RPC semantics so passing the callback
  duplicates it and the client retains the copy that it explicitly disposes.
- Removing `allow_irrevocable_stub_storage` is a data migration: delete every
  backend `rpc-sub:*` row while the flag remains enabled before any Worker in
  the restore chain disables it. Client `livestore-rpc-sub:*` markers are plain
  strings and may be cleared in the same migration.
- The implementation remains experimental until Cloudflare documents the API
  and its persistence behavior across Worker redeploys. It must not be used
  across an untrusted Worker boundary.
