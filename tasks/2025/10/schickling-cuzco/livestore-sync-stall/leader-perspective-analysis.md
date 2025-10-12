# Leader-Side Root Cause Analysis: Local Push Starved by Pull Precedence (with Backend)

## Context

Symptom in Web LinearLite (with a CF DO sync backend): after a local change (e.g., issue priority), the client session shows `pending > 0` and the leader does not emit a corresponding advance/notify signal for that event within the window. Earlier events do advance fine. The essence is a concurrency/precedence issue: upstream pull can temporarily starve local push processing at the wrong moment.

## Key Components

- ClientSessionSyncProcessor (client session): `packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts:208`
- LeaderSyncProcessor (leader): `packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts:480`
- SyncState payloads: `packages/@livestore/common/src/sync/syncstate.ts:156`

## High-Level Timeline (Shorthand)

- Startup/UI emits client document events; client locally pushes e0+1, e0+2, e0+3.
- Client pulls `upstream-advance`; a rebase occurs; client re-encodes and pushes e53+1r1…
- Leader processes e53+1r1, e53+2r1, e53+3r1 and notifies; client confirms; then e53+4r1 also processes and notifies.
- Priority change (the repro): client pushes e54; leader logs push:recv e54 but no push:advance/notify is emitted for e54 within the window; client never sees a matching pull; session.pending stays at 1.

## Why leader-side signaling is expected

The client session has no intrinsic knowledge of where the leader wants the chain to continue after a push reject; it only learns a push failed. In architectures with an upstream backend, pull payloads (advance/rebase) drive consistent state convergence. In no-backend mode, the leader must provide equivalent guidance. A `LeaderAheadError` reflects a disagreement about the next valid parent; thus the leader should coordinate the rebase by sending an explicit instruction to the client session(s).

## Concrete Code Reference Points

- Local push application (leader): `backgroundApplyLocalPushes(...)`
- Upstream pulling (leader): `backgroundBackendPulling(...)`
- Latches controlling precedence:
  - localPushesLatch: pull closes it; push waits on it
  - pullLatch: push closes it while applying; pull waits on it
  - This enforces “pull-before-push” sequencing during active pulling.

## Impact

- With backend: bursts of upstream pages can temporarily starve local push processing. If a user change (e54) arrives at the wrong moment, the leader may log push:recv(e54) but not process it quickly enough to emit notify; the client’s `waitForProcessing` then exposes a visible stall (`pending = 1`).
- Without backend: a different issue exists (reject branch doesn’t notify). Not the focus here.

## Conclusion (Leader-Side Root Cause)

The LeaderSyncProcessor does not send any rebase/advance payload to client sessions upon rejecting a local push (LeaderAheadError). This omission leaves client sessions unaware of the corrective action (rebase to the leader’s current head) and, combined with the client clearing its push queue, causes a permanent stall in no-backend scenarios.

## Next Steps (Design Direction, not implementation)

1) On local push reject:
   - Leader should proactively communicate a corrective payload to client sessions:
     - Either a `PayloadUpstreamRebase` including the client’s batch re-encoded on top of `leader.localHead`, or
     - Another explicit “rebase-to” instruction sufficient for the client to re-encode its pending chain.
2) Ensure `connectedClientSessionPullQueues.offer(...)` is invoked with a payload that causes the client to rollback its local materializations and rebuild `pending` atop the leader’s head.
3) Add a regression test mirroring the new client-session test from the leader’s perspective, ensuring a pull payload is emitted on reject.

## Collected Logs (Evidence – LinearLite Playwright)

Essence from the failing run (pre-seeded app, single priority change):

```
[TMP][client] local-push …
[TMP][client] push->leader …
[TMP][leader] push:recv …
… (earlier batches often show)
[TMP][leader] push:advance …
[TMP][leader] notify:advance …
[TMP][client] pull<-leader { payloadTag: 'upstream-advance' }
[TMP][client] pull:merge:advance …
[TMP][client] push->leader:ok

// Final event (the priority change):
[TMP][client] local-push { batchSize: 1, seqs: '54,0', … }
[TMP][client] push->leader { batchSize: 1, seqs: '54,0' }
[TMP][leader] push:recv { batchSize: 1, first: '54,0', last: '54,0' }
// No subsequent [TMP][leader] push:advance / notify:advance
// No corresponding [TMP][client] pull<-leader for this event
```

Interpretation: the leader did receive the priority-change push (push:recv e54).
Later logs show:

```
[TMP][leader] apply:gotLocalPushesLatch { seq: e54 }
[TMP][leader] latch:closePull
[TMP][leader] latch:openPull { reason: 'dropOldGen' }
```

This means the leader dequeued a batch containing e54, but after filtering by
current rebase generation, `newEvents.length === 0` (older generation), so the
leader dropped that batch ("dropOldGen") and did not emit advance/notify for e54.
No deferred resolution happened either (client used waitForProcessing), so the
client remained with `pending = 1` (the e54 change).

## Concurrency Analysis (with Backend)

The Playwright logs reveal a precise ordering that points to a fairness/precedence issue between leader pull and local push processing (with waitForProcessing on the client):

- Boot/UI triggers (client document events): e0+1, e0+2, e0+3 → client briefly pushes e0+1, then pulls upstream-advance and rebases (client logs `pull:merge:rebase`).
- Client pushes re-encoded chain: `push->leader { seq: e53+1r1+2 }`; leader: `push:recv e53+1r1+2` → `push:advance` at e53+1r1, then e53+2r1, then e53+3r1, each with `notify:advance`; client merges advances and logs `push->leader:ok`.
- Next: client pushes e53+4r1; leader `push:recv e53+4r1` → `push:advance` e53+4r1 → `notify:advance`; client merges and logs `push->leader:ok`.
- Priority change (the repro): client `local-push { seq: e54 }` → `push->leader { seq: e54 }`; leader logs `push:recv e54` but no `push:advance/notify:advance` occurs for e54 within the window; client never sees a pull for e54; `pending = 1`.
  - Additionally, leader later logs `apply:gotLocalPushesLatch { seq: e54 }` followed by `latch:openPull { reason: 'dropOldGen' }`, proving the batch was dropped due to rebase-generation mismatch (older gen) and thus never advanced/notified.

Why this points to concurrency/precedence rather than logic errors:

- Leader-side flows:
  - Local push processing is in `backgroundApplyLocalPushes(...)`, which waits on `localPushesLatch` before merging/materializing, then closes `pullLatch` to run atomically, and re-opens it after.
  - Upstream pulling is in `backgroundBackendPulling(...)`, which takes precedence by closing `localPushesLatch` while it processes pages, then re-opens it. This ensures pull-before-push sequencing.
  - With a real backend, bursts of upstream pages can close `localPushesLatch` frequently and for non-trivial durations.

- Client-side semantics in web adapter:
  - The push call uses `waitForProcessing: true` to keep back pressure.
  - That means the client won’t log `push->leader:ok` (and `pending` won’t drain) until the leader processes the push batch in `backgroundApplyLocalPushes` and resolves deferreds.

- In this failing case:
  - We do see `push:recv` for `54,0` (so the batch reached the leader), but we never see the subsequent `push:advance`/`notify:advance` and the client never logs `pull<-leader` for that event.
  - The most plausible explanation consistent with the design and logs is that `localPushesLatch` was closed by `backgroundBackendPulling` during upstream activity right after `push:recv`, so the local push batch was not processed within the test’s time window.

Therefore, with a backend present, the essence is pull precedence starving local push processing at just the wrong moment. The client’s back-pressure (`waitForProcessing`) then exposes the stall (pending stays non-zero) while the leader is busy with upstream pulls.

## How to Collect Logs in the Browser

- The leader runs in a dedicated/shared worker; the instrumentation uses `console.debug` with `[TMP]` prefixes.
- Run the LinearLite app and open DevTools (console shows worker logs).
- Repeat the priority-change action and capture `[TMP][client]` and `[TMP][leader]` lines.
- Alternatively, extend the Playwright test to hook `page.on('console')` and persist logs.
