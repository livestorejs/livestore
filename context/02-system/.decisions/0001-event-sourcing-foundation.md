# 0001 — Event sourcing / read-write separation as the foundational model

Status: accepted (founding decision; recorded 2026-07-16 from documented
history).

## Context

LiveStore needs one abstraction from which state management, persistence,
offline operation, and sync all fall out (LS-R01). The documented original
motivation: frustration with database schema migrations — separating the
write model from read models means evolving a read model never requires
migrating source data.

## Options

- **(a) Event sourcing with read/write separation — chosen.** The write
  model is an append-only, ordered log of domain events; read models
  (state) are derived via materializers and rebuildable at any time.
  Benefits as documented: simple mental model, preserves user intent,
  flexible read-model evolution without data migration, full change
  history for audit/debug, natural foundation for syncing (histories
  merge; states don't have to).
- **(b) Syncing mutable state directly.** Rejected: state-snapshot sync
  forces "who wins?" conflict decisions, records nothing about what
  happened, and inherits cache-consistency complexity (the "local data as
  cache" model the product positions against).
- **(c) Row-level sync of an existing database.** Rejected for LiveStore's
  scope: serves the existing-Postgres use case (ElectricSQL/Zero/
  PowerSync); LiveStore targets greenfield apps that want event semantics,
  not row replication (LS-A03).

## Evidence

Documented history: `docs/understanding-livestore/design-decisions.md`
(original motivation), `docs/understanding-livestore/event-sourcing.md`
(benefits/downsides), `docs/overview/why-livestore.mdx` (events vs mutable
state, comparison landscape). Implementation evidence: the entire
`02-system/` tree derives from this model.

## Consequences

- Accepted costs (documented): more boilerplate to define events; eventlog
  growth needs care; conceptual learning curve (LS-T03).
- Read-model migrations become rebuilds (LS-T04); the eventlog is the only
  data that must be preserved (LS-R04).
- Blind event rebase can produce semantically invalid states under
  concurrency — the pressure behind the command-replay proposal (RFC 0002,
  root LS-DQ1).
