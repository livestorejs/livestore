# Sync — Requirements

Role: `03-sync/` owns how eventlogs converge across clients. The pure merge
core lives in [01-syncstate](./01-syncstate/requirements.md), the drivers in
[02-processors](./02-processors/requirements.md); this node owns the
boundary: ordering authority and the provider contract that sync backends
realize. Provider realizations are child nodes.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS-R01, LS.SYS-R03)
and root LS-R03, LS-R05, LS-R08, LS-A02. Code:
`packages/@livestore/common/src/sync/`,
`leader-thread/{LeaderSyncProcessor,RejectedPushError}.ts`. Realization:
[03-cf](./03-cf/requirements.md).

ID note: former LS.SYS.SYNC-R02…R05 moved to LS.SYS.SYNC.SS-R01…R04 when
`01-syncstate/` was created; former R06…R08 renumbered to R02…R04.

## Requirements

- **LS.SYS.SYNC-R01 Upstream total order:** The sync backend is the single
  ordering authority per eventlog: it accepts a push only when the batch
  chains onto its current head and thereby linearizes concurrent writers.
  Sequence numbers are assigned by clients; the backend arbitrates, it does
  not renumber. Clients never resolve order among themselves.
  `refines: LS-R05`
- **LS.SYS.SYNC-R02 Provider contract:** A sync provider realizes
  `connect/pull/push/ping` plus connectivity signal, capability flags, and
  metadata against the schema-defined event encoding — nothing else about
  the engine. `refines: LS-R08`
- **LS.SYS.SYNC-R03 Typed failure taxonomy:** Push rejection and backend
  failures are tagged error families with a uniform recovery rule (rebase
  and retry); defects stay distinguishable from expected sync conditions
  like being offline. `refines: LS.SYS-R03`
- **LS.SYS.SYNC-R04 Bounded transport batches:** Providers bound push/pull
  batches (≤100 events per message at the Cloudflare transports) and chunk
  oversized payloads below the transport frame limit; batches are strictly
  ascending.
