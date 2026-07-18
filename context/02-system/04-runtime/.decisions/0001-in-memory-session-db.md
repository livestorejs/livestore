# 0001 — In-memory session database for synchronous reads

Status: accepted (founding decision; recorded 2026-07-16 from documented
history).

## Context

Reads must be synchronous on the UI thread (LS-R02, LS-R14): no loading
states, no async waterfall per query. Persistence and sync live in the
leader, typically another thread.

## Options

- **(a) In-memory SQLite per client session (usually the main thread),
  persisted database in the leader — chosen.** Documented rationale: "run
  in-memory SQLite in main-thread to enable synchronous queries", with "a
  second SQLite database for persistence running in a separate thread".
- **(b) Query the leader's persisted database across the worker
  boundary.** Rejected by implication of the documented rationale: every
  read would be asynchronous message-passing — exactly the loading-state
  model the product rejects.

## Evidence

Documented history: `docs/understanding-livestore/design-decisions.md`;
`docs/overview/why-livestore.mdx` (no loading states for reads).
Implementation evidence: session boot imports a leader snapshot (or
fast-path file read) into an in-memory DB (`make-client-session.ts`,
[spec.md](../spec.md) §Session Boot).

## Consequences

- Per-session memory cost, accepted as LS-T02; data must fit in memory
  (LS-A01), documented as workable "up to ~1 GB" per store.
- Dual databases per client (session in-memory + leader persisted) create
  the snapshot/fast-path boot machinery and the head-consistency
  obligations (LS.SYS.RT-R15).
