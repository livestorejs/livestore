# Runtime — Spec

This document specifies the LiveStore runtime topology, the adapter contract,
and the transport/persistence substrates. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: topology roles, the adapter and leader-proxy contracts, webmesh
transport, SQLite substrate entrypoints. Does not define: sync semantics
(`../03-sync/`), the Store surface (`../05-store/`), or per-platform
realizations ([01-web/](./01-web/spec.md),
[02-cloudflare/](./02-cloudflare/spec.md)).

## Topology

```
client (clientId)
├── client session A (sessionId)   in-memory SQLite + reactivity graph
├── client session B (sessionId)   in-memory SQLite + reactivity graph
│        │  ClientSessionLeaderThreadProxy
│        ▼  (events.pull/push/stream · initialState · syncState ·
│            networkStatus · export · sendDevtoolsMessage)
└── leader thread                  persisted eventlog + state DB
         │  SyncBackend contract (semantics: ../03-sync/)
         ▼
   sync backend
```

- One leader per client owns `dbEventlog` + `dbState` and the upstream sync
  connection (LS.SYS.RT-R01). Sessions never touch persistence directly.
- The `LeaderSyncProcessor` runs in the leader; the
  `ClientSessionSyncProcessor` runs in each session. Their semantics are
  specified in `../03-sync/`; this node only fixes their placement.
- Leadership is observable through a `lockStatus` subscription; handover is
  realization-specific (see children) but must satisfy LS.SYS.RT-R04.

## Adapter Contract

An `Adapter` is a function from adapter args to a booted `ClientSession`
(`packages/@livestore/common/src/adapter-types.ts`,
`make-client-session.ts`). It must provide:

| Piece | Purpose |
| --- | --- |
| `sqliteDb` | Session-local SQLite database for state reads |
| `leaderThread` proxy | The only channel to persistence and sync |
| `lockStatus` | Leadership signal (LS.SYS.RT-R04) |
| `shutdown` | Intentional-shutdown propagation (LS.SYS.RT-R06) |
| `connectWebmeshNode` | Devtools/mesh connectivity where supported |
| boot info | Leader head, migrations report, storage mode (LS.SYS.RT-R07) |

The leader side is assembled by `makeLeaderThreadLayer`
(`common/src/leader-thread/`): eventlog init, materializer wiring, optional
sync backend, devtools hooks, shutdown channel.

## Transport Substrate (webmesh)

`@livestore/webmesh` provides named mesh nodes with three channel kinds
(`mesh-schema.ts`):

- **Direct channels** — negotiated `MessagePort` links carrying
  transferables; used session ⇄ leader where the platform allows.
- **Proxy channels** — hop-routed packets for contexts without direct ports.
- **Broadcast channels** — fan-out without acks (e.g. devtools session info).

Edges exist over message ports, workers, and websockets
(`websocket-edge.ts`). Node naming for devtools follows
`Devtools.makeNodeName.*`. Split into its own child node when content
warrants (e.g. non-LiveStore consumers).

## Persistence Substrate (SQLite)

`@livestore/sqlite-wasm` exposes one WASM SQLite build via entrypoints `.`,
`./browser`, `./cf`, `./node`, `./load-wasm`; `@livestore/wa-sqlite` is the
vendored build (VFS + WebLocks). Realizations choose the VFS (OPFS in web,
Durable Object storage in cf) but share query/materialization behavior
(LS.SYS.RT-R09). Split into its own child node when content warrants.

## Realizations

| Realization | Node | Status |
| --- | --- | --- |
| Web (workers, OPFS) | [01-web/](./01-web/spec.md) | in-repo |
| Cloudflare (Durable Object) | [02-cloudflare/](./02-cloudflare/spec.md) | in-repo |
| Node, Expo, Tauri/Electron | contrib | stub pending LS-DQ2 |

## Leadership Handover

Leader boot rehydrates sync state entirely from the persisted eventlog
(`make-leader-thread-layer.ts` `getInitialSyncState`,
`LeaderSyncProcessor.boot`):

- the upstream head is read from the eventlog system table
  (`Eventlog.getBackendHeadFromDb`);
- pending events are re-derived as all persisted events after the upstream
  head (`Eventlog.getEventsSince`);
- pending non-client-only events are re-enqueued to the backend push queue.

A new leader therefore continues from persisted state alone; no state is
transferred from the previous leader. Boot asserts the invariant
`backendHead <= localHead` and fails as a defect otherwise. Election is
realization-specific (e.g. Web Locks on web) but must be blocking so exactly
one leader exists per client at any time.

## Open Design Questions

- **LS.SYS.RT-DQ1 Handover races.** Rehydration semantics are captured above,
  but the race where a push batch is accepted upstream concurrently with
  leader death (new leader re-pushes the same events and must recover via
  pull + rebase) is not explicitly contracted or covered by a targeted test
  per realization.
