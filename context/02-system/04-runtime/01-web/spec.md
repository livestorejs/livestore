# Web Runtime — Spec

This document specifies the browser adapter
(`packages/@livestore/adapter-web`). It builds on
[requirements.md](./requirements.md); the mechanism-agnostic contract is in
[../spec.md](../spec.md).

## Status

Draft.

## Topology

```
tab 1 (main thread)      tab 2 (main thread)
  client session           client session
  in-memory SQLite         in-memory SQLite
       │                        │
       └──────┬─────────────────┘
              ▼
        shared worker            liveness held via navigator.locks
              │                  (termination lock per storeId)
              ▼
        leader worker            leader thread: eventlog + state on OPFS,
                                 upstream sync
```

- `web-worker/client-session/persisted-adapter.ts` boots a session: loads
  WASM SQLite for the session DB, connects to the shared worker, obtains the
  leader proxy, wires devtools (`devtools-web-channel.ts`).
- `web-worker/shared-worker/make-shared-worker.ts` mediates tabs ⇄ leader and
  holds a Web Lock (`livestore-shared-worker-termination-lock-<storeId>`) so
  waiters are notified when it dies (LS.SYS.RT.WEB-R02).
- `web-worker/leader-worker/make-leader-worker.ts` hosts
  `makeLeaderThreadLayer` with OPFS-backed databases; falls back to in-memory
  with a boot warning when OPFS is unavailable (LS.SYS.RT.WEB-R03).

## Variants

| Variant | Entry | Tradeoff |
| --- | --- | --- |
| Worker (default) | `web-worker/` | Full: multi-tab, OPFS, devtools |
| Single-tab | `single-tab/` | No shared worker (dedicated leader worker still spawned); one tab only; devtools disabled |
| In-memory | `in-memory/` | No persistence; leader colocated in-context; tests/demos |

All variants return the same `ClientSession` contract (LS.SYS.RT.WEB-R04).
The worker adapter falls back to single-tab automatically when
`SharedWorker` is unavailable (e.g. Android Chrome).

## Locks and Leadership

Two Web Locks per store drive coordination:

- **Tab lock** (`livestore-tab-lock-<storeId>`) — cooperative leader
  election: a booting tab first tries `ifAvailable`, then blocks on the lock
  if another tab leads. Release on leader scope exit promotes the next
  waiting tab. The lock is never stolen; election is blocking so exactly one
  leader exists and no events are dropped.
- **Shared-worker termination lock**
  (`livestore-shared-worker-termination-lock-<storeId>`) — the shared worker
  grabs this with `steal: true` and holds it forever; its release is the
  only signal that the shared worker died. Tabs can opt in to awaiting it
  (`awaitSharedWorkerTermination`, default false — awaiting would block
  forever in multi-tab use since the shared worker outlives any one tab).

## Leader Handover (port swap)

Only the lock-holding tab spawns the dedicated leader worker
(`livestore-worker-<storeId>-<sessionId>`) and hands one `MessagePort` end
to the worker and the other to the shared worker (`UpdateMessagePort`). The
shared worker mediates all tabs' RPCs to whichever port is current. On a
swap it enforces **invariant stability** — `storeId`, `storageOptions`,
`syncPayload`, `liveStoreVersion`, `devtoolsEnabled` must match what the
first leader registered; a mismatch hard-fails with a schema diff (so e.g.
devtools-on and devtools-off tabs of one store cannot coexist). A
`workerDisconnectChannel` broadcast exists on takeover but currently has no
listener (inert).

## Identity Persistence

Both adapters derive identity the same way (`getPersistedId`):

- `clientId`: `options.clientId` override, else `localStorage`
  key `livestore:clientId:<storeId>` — shared by all tabs of the origin,
  created once as `nanoid(5)`.
- `sessionId`: `options.sessionId` override, else `sessionStorage` key
  `livestore:sessionId:<storeId>` — per tab; survives reloads and
  same-tab restores, a new tab gets a fresh id. Browser tab duplication
  copies `sessionStorage`, so a duplicated tab inherits the same `sessionId`
  (platform behavior, currently not guarded against).
- Non-window contexts fall back to a fresh random id per boot.

When the leading tab closes, the tab lock releases, a waiting tab spawns a
fresh leader worker, and the shared worker swaps ports; recovery follows the
handover contract in [../spec.md](../spec.md).
