# Runtime — Requirements

Defines how LiveStore runs on a platform: the leader ⇄ client-session
topology, the adapter contract that realizes it, and the transport and
persistence substrates underneath. Refines the platform-agnostic-core and
determinism requirements of the root ([LS-R04], [LS-R05], [LS-R07]).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). Sync
*semantics* are owned by `02-system/03-sync/`; this node only places the sync
processors in the topology. Children: realizations
[01-web/](./01-web/requirements.md),
[02-cloudflare/](./02-cloudflare/requirements.md) (node and Expo adapters are
contrib-owned, stub shape pending LS-DQ2), and the transport substrate
[03-webmesh/](./03-webmesh/requirements.md).

## Assumptions

- **LS.SYS.RT-A01 Cooperative contexts:** All execution contexts of one client
  (sessions, leader) can exchange messages and transferables through some
  platform channel primitive.

## Requirements

### Leader ⇄ client-session topology

- **LS.SYS.RT-R01 Single leader per client:** At any time exactly one leader
  per client owns the persisted eventlog, the state database, and upstream
  sync. `refines: LS-R04`
- **LS.SYS.RT-R02 Proxy-only durable effects:** Client sessions perform every
  durable effect (event push, sync, persistence writes) exclusively through
  the leader-thread proxy contract. A realization may let a booting session
  *read* persisted state directly (fast path), provided the derived state and
  head match what the leader would provide.
- **LS.SYS.RT-R03 Session resume:** A session boots from an initial state
  snapshot (fast-path read or leader-provided recreate snapshot with a
  migrations report) and resumes event streaming from its cursor without
  event loss or duplication.
- **LS.SYS.RT-R04 Leadership handover:** When the current leader context goes
  away, another eligible context takes over leadership without data loss;
  sessions observe leadership via a lock status signal.
- **LS.SYS.RT-R10 Push-rejection contract:** A rejected push
  (`RejectedPushError` family) is recoverable: the session rebases and
  retries; events are never dropped (see spec §Boundary Error Taxonomy).
  Adopted 2026-07-16 (interview).
- **LS.SYS.RT-R12 Handover invariant stability:** Store invariants (storeId,
  storage options, sync payload, versions) stay stable across leader
  transitions; a mismatch fails loudly instead of silently reconfiguring
  (see spec §Realizations). Adopted 2026-07-16 (interview).
- **LS.SYS.RT-R13 Boot safety assertion:** Leader boot rejects
  `backendHead > localHead` as an unrecoverable defect (see spec §Leadership
  Handover). Adopted 2026-07-16 (interview). `refines: LS-R04`

### Session boot

- **LS.SYS.RT-R11 Boot-progress surface:** Adapters stream boot progress
  (`loading → migrating → rehydrating → syncing → done`, plus an optional
  warning stage) so apps can render boot state (see spec §Session Boot).
  Adopted 2026-07-16 (interview).
- **LS.SYS.RT-R14 Blocking initial-sync bound:** With blocking initial sync
  configured, boot waits for the first sync page up to a timeout, then
  proceeds (see spec §Session Boot). Adopted 2026-07-16 (interview).
  `refines: LS-R03`
- **LS.SYS.RT-R15 Fast-path read consistency:** Fast-path-derived head and
  state must equal what the leader would report; divergence is detected,
  not trusted. Adopted 2026-07-16 (interview); not yet enforced — see
  [.delta/DELTA-001-fast-path-unvalidated.md](./.delta/DELTA-001-fast-path-unvalidated.md).
  `refines: LS-R05`

### Adapter contract

- **LS.SYS.RT-R05 Adapter realization:** An adapter instantiates a client
  session for its platform, providing: a session-local SQLite database, a
  leader-thread proxy, lock status, shutdown handling, and devtools
  connectivity (where supported). `refines: LS-R07`
- **LS.SYS.RT-R06 Shutdown-cause propagation:** Shutdown and terminal failure
  causes propagate to all contexts of a client (shutdown channel); sessions
  distinguish intentional shutdown from failure. Single-context realizations
  may degenerate to no channel.
- **LS.SYS.RT-R07 Storage-mode transparency:** Persistence may degrade to
  in-memory (e.g. private browsing); the adapter must surface the effective
  storage mode and a boot warning instead of failing silently.
- **LS.SYS.RT-R16 Storage-mode source of truth:** The effective storage mode
  has one source of truth; the app-visible mode always matches the actual
  database backing. Adopted 2026-07-16 (interview); today two independent
  probes can disagree — see
  [.delta/DELTA-002-dual-storage-probes.md](./.delta/DELTA-002-dual-storage-probes.md).

### Substrates

- **LS.SYS.RT-R08 Transport-agnostic messaging:** Cross-context communication
  uses webmesh channels (direct, proxy, broadcast) so topology logic is
  independent of platform channel primitives.
- **LS.SYS.RT-R09 Portable SQLite substrate:** Leader and session databases run
  on the same WASM SQLite build exposed through per-platform entrypoints
  (browser, node, cf), keeping materialization identical across platforms.
  `refines: LS-R05`
