# Web Leadership — Spec

This document specifies leader election, handover, and death detection in
the browser adapter. It builds on [requirements.md](./requirements.md); the
worker/port mechanics live in [../02-topology/](../02-topology/spec.md).

## Status

Draft.

## The Two Locks

Two Web Locks per store drive coordination
(`persisted-adapter.ts:208-209`):

- **Tab lock** (`livestore-tab-lock-<storeId>`) — cooperative leader
  election. A booting tab first tries `{ifAvailable: true}`
  (`WebLock.tryGetDeferredLock`); on failure it blocks on the lock
  (`waitForDeferredLock`, `{ifAvailable: false}`) until the current leader
  releases. The lock is never stolen; election is blocking so exactly one
  leader exists per client and no events are dropped
  (`persisted-adapter.ts:290-296,373-381`; LS.SYS.RT.WEB.LEAD-R02).
  `lockStatus` is seeded `has-lock`/`no-lock` from the initial attempt.
- **Shared-worker termination lock**
  (`livestore-shared-worker-termination-lock-<storeId>`) — the shared
  worker grabs this with `{steal: true}` and holds it forever via a
  never-resolving promise (`make-shared-worker.ts:36-42`); its release is
  the only signal that the shared worker died. Tabs may opt in to awaiting
  it (`awaitSharedWorkerTermination`, default false — awaiting would block
  forever in multi-tab use since the shared worker outlives any one tab).

## Election and Handover

Only the lock holder spawns the dedicated leader worker and performs the
`UpdateMessagePort` swap (see topology). On leader scope exit the deferred
lock resolves, the Web Lock releases, and the next waiting tab promotes:
it spawns a fresh leader worker, whose boot rehydrates entirely from the
persisted eventlog (parent Leadership Handover contract,
`LS.SYS.RT-R12`/`R13`). A `workerDisconnectChannel` broadcast is sent on
takeover but has no listener anywhere — currently inert
(`persisted-adapter.ts:341`).

## Death Detection

There is no heartbeat (LS.SYS.RT.WEB.LEAD-R03). Crash detection is
entirely lock-release semantics:
leader-tab death releases the tab lock (blocked follower promotes);
shared-worker death releases the termination lock. RPC transport failures
in the shared worker tear down the leader context (`dieOnRpcClientError`).

## Shutdown Propagation

A `BroadcastChannel` (`livestore.shutdown.<storeId>`) carries the
terminating cause to all contexts (`LS.SYS.RT-R06`): sessions map
`IntentionalShutdownCause` to a successful exit and everything else
(`UnknownError`, `BackendIdMismatchError`, `MaterializeError`) to a failed
exit (`persisted-adapter.ts:258-267`). Shutdown finalizers log interrupts
and intentional causes at debug level, real failures as errors. Sessions
register a `beforeunload` handler where a window exists
(`persisted-adapter.ts:579-586`); the handler itself is supplied by
`makeClientSession`.
