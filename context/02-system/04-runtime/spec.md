# Runtime — Spec

This document specifies the LiveStore runtime topology, the adapter contract,
and the transport/persistence substrates. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: topology roles, session boot, the adapter and leader-proxy
contracts, the boundary error taxonomy, SQLite substrate entrypoints. Does
not define: sync semantics (`../03-sync/`), the Store surface
(`../05-store/`), the transport substrate
([03-webmesh/](./03-webmesh/spec.md)), or per-platform realizations
([01-web/](./01-web/spec.md), [02-cloudflare/](./02-cloudflare/spec.md)).

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
  connection (LS.SYS.RT-R01). Sessions route every durable effect through
  the leader; on web a booting session may *read* the persisted state DB
  directly (fast path, below) but never writes it.
- The `LeaderSyncProcessor` runs in the leader; the
  `ClientSessionSyncProcessor` runs in each session. Their semantics are
  specified in `../03-sync/`; this node only fixes their placement.
- Leadership is observable through a `lockStatus` subscription; handover is
  realization-specific (see children) but must satisfy LS.SYS.RT-R04.
- The split itself and the in-memory session database are founding
  decisions — see
  [.decisions/0002](./.decisions/0002-leader-session-worker-split.md) and
  [.decisions/0001](./.decisions/0001-in-memory-session-db.md).

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

## Proxy Contract

`ClientSessionLeaderThreadProxy`
(`common/src/ClientSessionLeaderThreadProxy.ts`) is the session's only
channel for durable effects:

| Member | Shape | Purpose |
| --- | --- | --- |
| `events.pull({ cursor })` | stream | upstream payloads from the leader |
| `events.push(batch)` | effect | submit local events (rejection: below) |
| `events.stream(...)` | stream | eventlog range reads (devtools, export) |
| `initialState` | `{ leaderHead, migrationsReport }` | boot snapshot info |
| `export` | effect | state DB snapshot |
| `getEventlogData` | effect | eventlog DB snapshot (distinct from `export`) |
| `getSyncState` / `syncState` | `Subscribable` (get + changes) | leader sync state |
| `networkStatus` | `Subscribable` (get + changes) | connectivity (folds in devtools latch overrides) |
| `sendDevtoolsMessage` | effect | devtools control channel |

Realizations may expose a superset over their worker RPC (web adds
`GetLeaderHead`, `Shutdown`, `WebmeshWorker.CreateConnection`, boot-status
streaming — `worker-schema.ts`); the proxy above is the portable contract.

## Session Boot

Two boot paths produce the session's initial in-memory state:

- **Fast path (web):** the session reads the persisted state DB directly
  from OPFS and derives `leaderHead` from `SESSION_CHANGESET_META_TABLE` —
  without touching the leader. This is the one sanctioned direct
  persistence *read*; the snapshot is currently trusted without validation
  (code TODO), and its head source differs from the leader's
  (eventlog-derived), so the two can in principle diverge — violating
  LS.SYS.RT-R15
  ([DELTA-001](./.delta/DELTA-001-fast-path-unvalidated.md)).
- **Slow path:** the leader provides a recreate snapshot plus a
  `migrationsReport` (`GetRecreateSnapshot`).

Boot progress is a streamed `BootStatus` surface
(`adapter-types.ts`): `loading → migrating → rehydrating → syncing → done`,
with per-stage progress counts and an optional `warning` stage (e.g. OPFS
unavailable) (LS.SYS.RT-R11). With `initialSync: Blocking` the leader delays
boot completion until the first sync page arrives, bounded by a timeout
(LS.SYS.RT-R14).

`storageMode` (persisted vs in-memory fallback) is derived from the client
session's own storage probe, not from leader boot info; Cloudflare hardcodes
`persisted`. On web, client and leader probe storage independently and can
in principle disagree (two probes, one reported mode) — violating
LS.SYS.RT-R16 ([DELTA-002](./.delta/DELTA-002-dual-storage-probes.md)).

## Transport Substrate (webmesh)

Owned by [03-webmesh/](./03-webmesh/spec.md): mesh nodes, edges, and the
three channel kinds (direct / proxy / broadcast) with their reliability
semantics.

## Persistence Substrate (SQLite)

`@livestore/sqlite-wasm` exposes one WASM SQLite build via entrypoints `.`,
`./browser`, `./cf`, `./node`, `./load-wasm`; `@livestore/wa-sqlite` is the
vendored build (VFS + WebLocks). Realizations choose the VFS (OPFS in web,
Durable Object storage in cf) but share query/materialization behavior
(LS.SYS.RT-R09). Split into its own child node when content warrants.

## Realizations

Full registry (in-repo + contrib, with conformance status):
[realizations.md](./realizations.md). In-repo children:
[01-web/](./01-web/spec.md) and [02-cloudflare/](./02-cloudflare/spec.md).

Realizations with leader transitions must keep store invariants (storeId,
storage options, sync payload, versions) stable across a handover
(LS.SYS.RT-R12); the web realization enforces this at the shared-worker
port swap ([01-web/](./01-web/spec.md)).

## Leadership Handover

Leader boot rehydrates sync state entirely from the persisted eventlog
(`make-leader-thread-layer.ts` `getInitialSyncState`,
`LeaderSyncProcessor.boot`):

- the upstream head is read from the eventlog system table
  (`Eventlog.getBackendHeadFromDb`; the value `backendHead` here is what
  `../03-sync/` calls `upstreamHead`);
- pending events are re-derived as all persisted events after the upstream
  head (`Eventlog.getEventsSince`);
- pending non-client-only events are re-enqueued to the backend push queue.

A new leader therefore continues from persisted state alone; no state is
transferred from the previous leader. Boot asserts the invariant
`backendHead <= localHead` and fails as a defect otherwise. Election is
realization-specific (e.g. Web Locks on web) but must be blocking so exactly
one leader exists per client at any time.

## Boundary Error Taxonomy

The session ⇄ leader boundary has a typed failure contract:

- **Push rejection (recoverable):** `RejectedPushError` =
  `LeaderAheadError` | `NonMonotonicBatchError` |
  `StaleRebaseGenerationError` (`leader-thread/RejectedPushError.ts`).
  The session responds by rebasing and retrying; events are never dropped
  (LS.SYS.RT-R10). Semantics: [../03-sync/](../03-sync/spec.md).
- **Shutdown broadcast:** the shutdown channel carries
  `IntentionalShutdownCause` (reasons: `devtools-reset`, `devtools-import`,
  `adapter-reset`, `manual`, `backend-id-mismatch`) *and* terminal failure
  causes (`UnknownError`, `BackendIdMismatchError`, `MaterializeError`) —
  it is a failure broadcast, not an intentional-only signal. Sessions map
  intentional causes to a successful exit and everything else to a failed
  exit. Cloudflare has no channel (noop; single-context).
- **Boot defect:** leader boot asserts `backendHead <= localHead` and dies
  otherwise (LS.SYS.RT-R13) — the sole handover safety check; there is no
  cross-source reconciliation beyond it.

## Open Design Questions

- **LS.SYS.RT-DQ1 Handover races.** Rehydration semantics are captured above,
  but the race where a push batch is accepted upstream concurrently with
  leader death (new leader re-pushes the same events and must recover via
  pull + rebase) is not explicitly contracted or covered by a targeted test
  per realization.
