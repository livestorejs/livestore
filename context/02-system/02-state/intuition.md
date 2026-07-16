# State (Read Model) — Intuition

*For: contributors touching materializers or state realizations · Assumes:
[../01-event-model/intuition.md](../01-event-model/intuition.md) · Covers:
why state is disposable and what a materializer really is*

## State is a cache of the log

The eventlog is truth; state is a derived, disposable view of it. Nothing in
the app writes state directly — the only writer is the materializer pipeline
processing committed events. Delete the state database and replay the log:
you must get the same state back (same rows everywhere; dev builds compare
materializer-result hashes to enforce it). That property is not an
implementation detail, it is the contract that makes three hard problems
easy:

- **Schema changes** — reshape tables and replay; no data migration of
  truth, because truth was never in the tables (rebuild beats migrate).
- **Rebase** — undo the last few materializations (recorded as SQLite
  session changesets), re-apply on the new history, done.
- **Trust** — any state corruption is recoverable; the log is the backup.

## A materializer is a deterministic step function

```
(state, event) ──materializer──▶ mutations
```

It may read current state (`context.query`) — so determinism means "same
event applied to same state gives same mutations," not "ignores state."
What it may never do is depend on anything else: no clock, no randomness, no
network. Every client runs the same step function over the same history and
must land in the same place; in dev, result hashes are compared across
materialization sites to catch violations rather than trusting convention.

Coverage is total by type: every non-derived event has exactly one
user-defined materializer (the framework wires implicit ones for derived
events like client-document sets). An event without an interpretation, or
with two competing ones, cannot exist.

## The dimension, not the database

This node owns the realization-agnostic contract: mutation format, read-only
query surface, rebuild, rollback, drift handling. SQLite
([01-sqlite/](./01-sqlite/spec.md)) is the shipping realization — tables,
query builder, client documents — but the layers above depend only on the
contract, which is what keeps other realizations possible (root
`roadmap.md`).
