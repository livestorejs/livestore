# Event Model — Requirements

Role: `01-event-model/` owns how change is represented: event definitions,
event shapes, sequence numbers, and the append-only eventlog. It is the
foundation every other system node derives from.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS-R01, LS.SYS-R02)
and root LS-R04…R06. Code: `packages/@livestore/common/src/schema/EventDef/`,
`schema/LiveStoreEvent/`, `schema/EventSequenceNumber/`,
`leader-thread/eventlog.ts`.

## Requirements

### Event definitions

- **LS.SYS.EVT-R01 Complete definitions:** An event type is declared by an
  event definition: unique name (versioned by convention, e.g.
  `v1.TodoCreated`), payload schema, and sync scope. Optional: facts callback
  (experimental), deprecation reason. The derived flag is framework-set
  (client documents), never user-supplied.
- **LS.SYS.EVT-R02 Sync scope:** Every event is either `synced` (distributed
  via the sync backend) or `clientOnly` (reaches all sessions of the committing
  client, never the backend). `refines: LS-R04`
- **LS.SYS.EVT-R03 Schema-validated payloads:** Event payloads are
  encoded/decoded through their schema; invalid payloads are rejected at commit
  time. `refines: LS.SYS-R02`
- **LS.SYS.EVT-R04 Deprecation without removal:** Event definitions can be
  marked deprecated; committing a deprecated event warns but still works —
  historical events must remain decodable.

### Ordering

- **LS.SYS.EVT-R05 Composite sequence numbers:** Every committed event has a
  composite sequence number `{global, client, rebaseGeneration}`. Global
  numbers are allocated optimistically by the committing client and admitted
  into the canonical total order by the sync backend, which only accepts a
  push extending its current head (otherwise the client rebases and
  re-numbers). Client numbers order client-only events between global
  positions; the rebase generation increments on each rebase.
- **LS.SYS.EVT-R06 Canonical notation:** Event positions are written in the
  `e{global}[.{client}][r{rebaseGeneration}][']` notation (see
  `contributor-docs/events-notation.md`) across docs and tests; code emits
  the `e{global}[.{client}][r{gen}]` subset via `toString`/`fromString`.
- **LS.SYS.EVT-R10 Notation round-trip:** The canonical notation round-trips
  through code (`toString`/`fromString`) including the unconfirmed (`'`) and
  client (`A:`/`B:`) markers of `contributor-docs/events-notation.md`.
  Adopted 2026-07-16 (interview); code covers only the R06 subset today —
  see
  [.delta/DELTA-001-notation-partial.md](./.delta/DELTA-001-notation-partial.md).

### Eventlog

- **LS.SYS.EVT-R07 Append-only:** The persisted eventlog only grows; rebase
  re-parents pending (unconfirmed) events but never rewrites confirmed history.
  `refines: LS-R04`
- **LS.SYS.EVT-R08 Self-describing log:** The eventlog persists enough metadata
  (event name, schema hash, sequence numbers, sync status) to detect schema
  drift and to serve as the source for full state rebuilds.
- **LS.SYS.EVT-R09 Self-decoding rows:** Every eventlog row carries the event
  name, args, per-row schema hash, composite sequence number, parent
  sequence number, and client/session identity — decodable without external
  context (sharpens LS.SYS.EVT-R08 to a column-level enumeration; see
  [spec.md](./spec.md) §Eventlog). Adopted 2026-07-16 (interview).
