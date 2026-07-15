# Runtime — Requirements

Defines how LiveStore runs on a platform: the leader ⇄ client-session
topology, the adapter contract that realizes it, and the transport and
persistence substrates underneath. Refines the platform-agnostic-core and
determinism requirements of the root ([LS-R04], [LS-R05], [LS-R07]).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). Sync
*semantics* are owned by `02-system/03-sync/`; this node only places the sync
processors in the topology. Realizations: [01-web/](./01-web/requirements.md),
[02-cloudflare/](./02-cloudflare/requirements.md); node and Expo adapters are
contrib-owned (stub shape pending LS-DQ2).

## Assumptions

- **LS.SYS.RT-A01 Cooperative contexts:** All execution contexts of one client
  (sessions, leader) can exchange messages and transferables through some
  platform channel primitive.

## Requirements

### Leader ⇄ client-session topology

- **LS.SYS.RT-R01 Single leader per client:** At any time exactly one leader
  per client owns the persisted eventlog, the state database, and upstream
  sync. `refines: LS-R04`
- **LS.SYS.RT-R02 Proxy-only leader access:** Client sessions interact with the
  leader exclusively through the leader-thread proxy contract (event
  pull/push/stream, initial state, export, sync state, network status).
- **LS.SYS.RT-R03 Session resume:** A session boots from the leader's initial
  state (leader head cursor, migrations report, storage mode) and resumes event
  streaming from its cursor without event loss or duplication.
- **LS.SYS.RT-R04 Leadership handover:** When the current leader context goes
  away, another eligible context takes over leadership without data loss;
  sessions observe leadership via a lock status signal.

### Adapter contract

- **LS.SYS.RT-R05 Adapter realization:** An adapter instantiates a client
  session for its platform, providing: a session-local SQLite database, a
  leader-thread proxy, lock status, shutdown handling, and devtools
  connectivity (where supported). `refines: LS-R07`
- **LS.SYS.RT-R06 Graceful shutdown:** Intentional shutdown propagates to all
  contexts of a client (shutdown channel); sessions distinguish intentional
  shutdown from failure.
- **LS.SYS.RT-R07 Storage-mode transparency:** Persistence may degrade to
  in-memory (e.g. private browsing); the adapter must surface the effective
  storage mode and a boot warning instead of failing silently.

### Substrates

- **LS.SYS.RT-R08 Transport-agnostic messaging:** Cross-context communication
  uses webmesh channels (direct, proxy, broadcast) so topology logic is
  independent of platform channel primitives.
- **LS.SYS.RT-R09 Portable SQLite substrate:** Leader and session databases run
  on the same WASM SQLite build exposed through per-platform entrypoints
  (browser, node, cf), keeping materialization identical across platforms.
  `refines: LS-R05`
