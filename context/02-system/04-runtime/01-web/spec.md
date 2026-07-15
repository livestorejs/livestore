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
| Single-tab | `single-tab/` | No shared worker; one tab only |
| In-memory | `in-memory/` | No persistence; tests/demos |

All variants return the same `ClientSession` contract (LS.SYS.RT.WEB-R04).

## Open Design Questions

- **LS.SYS.RT.WEB-DQ1 Session persistence across reloads.** `sessionId` can
  persist across tab reloads; the exact contract (when it rotates) should be
  stated testably.
