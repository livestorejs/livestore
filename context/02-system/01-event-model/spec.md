# Event Model — Spec

This document specifies event definitions, event shapes, sequence numbers,
and the eventlog. It builds on [requirements.md](./requirements.md).

## Status

Draft.

## Event Definitions

```ts
// packages/@livestore/common/src/schema/EventDef/event-def.ts
type EventDef<TName, TType, TEncoded, TDerived> = {
  name: TName                      // unique, versioned by convention
  schema: Schema.Codec<TType, TEncoded>
  options: {
    clientOnly: boolean            // sync scope (LS.SYS.EVT-R02)
    facts: FactsCallback | undefined   // experimental
    derived: TDerived              // no user-defined materializer; framework
                                   // may wire an implicit one (client docs)
    deprecated: string | undefined // warn-at-commit (LS.SYS.EVT-R04)
  }
  (args: TType): { name; args }    // callable → partial event for commit()
}
```

Definitions are created via `Events.synced(...)` / `Events.clientOnly(...)`
— both thin wrappers over `defineEvent` (`define.ts:105`) — and collected in
an `EventDefRecord` on the store schema. A definition is callable (partial
event for `commit()`) and also exposes an `.encoded()` constructor
(`event-def.ts:74`) plus an `Event` type helper. `derived` is never set by
user code: client-document tables (`02-state/01-sqlite/`) auto-generate
derived client-only set-events with implicit materializers.

## Event Shape Lifecycle

An event passes through four shapes on its way from `commit()` to the sync
backend (`schema/LiveStoreEvent/{client,global}.ts`):

```
Partial {name, args}                       calling an EventDef
  └─▶ Client.Decoded / Client.Encoded     + seqNum, parentSeqNum,
       (payload decoded vs encoded)          clientId, sessionId
        └─▶ Client.EncodedWithMeta        + mutable meta (internal workhorse)
             └─▶ Global.Encoded           upstream wire/stored form
                 (client component dropped)
```

`EncodedWithMeta` (`client.ts:67`) is the shape the eventlog, both sync
processors, and rebase actually move around. Its `meta` carries:

| Field | Purpose |
| --- | --- |
| `sessionChangeset` | `sessionChangeset(data) \| no-op \| unset` — the SQLite session changeset recorded at materialization; consumed by rebase rollback |
| `syncMetadata` | provider-opaque per-event sync metadata (persisted as `syncMetadataJson`) |
| `materializerHashLeader` / `materializerHashSession` | dev-mode determinism hashes compared across materialization sites |

Conversions: `toGlobal()` / `EncodedWithMeta.fromGlobal` and
`Global.toClientEncoded` (`global.ts:32`, mapping global seqNums into
composite ones via `Client.fromGlobal`). All shapes are Effect Schema
structs; encoding happens at the boundary (LS.SYS.EVT-R03).

## Sequence Numbers

`EventSequenceNumber.Client.Composite = { global, client, rebaseGeneration }`.

- `global` — allocated optimistically by the committing client and
  *arbitrated* by the sync backend: the backend admits a push only if it
  extends the current head, otherwise the client rebases and re-numbers
  (`03-sync/`). Once admitted, global numbers are the canonical total order
  (LS.SYS.EVT-R05).
- `client` — local counter for client-only events committed between two
  global positions (`e5.1` = first client-only event after `e5`).
- `rebaseGeneration` — increments when the client rebases (`e3r1`).

Algebra (`EventSequenceNumber/client.ts`):

- `ROOT = {global: 0, client: 0, rebaseGeneration: 0}` — the origin every
  log starts from.
- `nextPair({seqNum, isClientOnly, rebaseGeneration?})` (`:227`) — for
  client-only events increments `client` and keeps `global`; for synced
  events increments `global`, resets `client` to 0, and always parents onto
  `{global, client: 0}` (a global event never has a client-component
  parent).
- `isGreaterThan(OrEqual)` / `max` — lexicographic on `(global, client)`.
- `diff` (`:163`) — returns `{global, client}` deltas only;
  `rebaseGeneration` is deliberately excluded.
- `toString`/`fromString` (`:79`, `:93`) — round-trip the
  `e{global}[.{client}][r{gen}]` subset of the notation (see below).

Notation (`contributor-docs/events-notation.md`): `e0`, `e3'` (unconfirmed),
`e5.1` (client-local), `e3r1` (after rebase), `A:`/`B:` client prefixes.
Code emits only the `e{global}[.{client}][r{gen}]` subset — the `'`
unconfirmed marker and client prefixes exist in docs/tests only
(LS.SYS.EVT-R06 is satisfied by the shared subset; full round-trip is
contracted by LS.SYS.EVT-R10 and tracked in
[.delta/DELTA-001-notation-partial.md](./.delta/DELTA-001-notation-partial.md)).

## Eventlog

The leader persists events in the eventlog database (`eventlog-tables.ts`;
row completeness contracted by LS.SYS.EVT-R09):

- **`eventlog`** — one row per event: composite seqNum triple (3-column PK)
  + parent triple, `name`, `argsJson` (note: `undefined` args are stored as
  `{}` — `eventlog.ts:248`), `clientId`, `sessionId`, per-row `schemaHash`,
  `syncMetadataJson`; indexed on `seqNumGlobal` and the full triple.
- **`__livestore_sync_status`** — the upstream head plus `backendId`, used
  to detect a changed backend identity (`BackendIdMismatchError` handling).

Properties:

- Logically append-only: confirmed history is immutable (LS.SYS.EVT-R07).
  Mechanically, rebase is implemented as delete + reinsert of the *pending*
  tail — `rollback()` physically `DELETE`s pending eventlog and changeset
  rows (`materialize-event.ts:210-219`) before the re-parented events are
  appended. The append-only contract holds for events at or below the
  upstream head.
- Each row is self-decoding: name, encoded args, composite position, and
  per-row schema hash — sufficient for drift detection and full rebuild
  (LS.SYS.EVT-R08). Unknown schema hashes are tolerated on read
  (`UNKNOWN_EVENT_SCHEMA_HASH`) so logs written by newer app versions do
  not brick older readers.
- `getEventsSince(seqNum)` (`eventlog.ts:47`) joins eventlog rows
  (eventlog DB) with their session-changeset rows (state DB) so the tail
  carries its rollback data — rebase state spans both databases.
- Writing an event whose definition is unknown is a defect
  (`shouldNeverHappen`, `eventlog.ts:228`); tolerance applies to reads
  only.

## Facts

**Maturity: experimental** (`schema/EventDef/facts.ts` is marked
not-fully-implemented). Facts are key/value constraints an event can
`set`/`unset`/`require`/`read`, intended for ordering constraints,
compaction, and conflict detection, consumed by the experimental next-gen
sync (`../03-sync/spec.md`). They are currently *not wired into
materialization at all*: the materializer context's `currentFacts` is a
constant empty `Map` (`common/src/materializer-helper.ts:70`). Not part of
the shipping contract.

## Command Replay

**Maturity: proposal.** RFC 0002 proposes commands as replayable captures of
user intent layered above events; placement in this tree is open (root
LS-DQ1). Not specified here.

## Open Design Questions

- **LS.SYS.EVT-DQ1 Event schema evolution:** Versioned names (`v1.*`) are
  convention only; there is no contract for migrating or upcasting old
  events beyond warn-and-tolerate. What is the durable evolution story?
- **LS.SYS.EVT-DQ2 Facts graduation:** What evidence (see
  `09-verification/`) graduates facts from experimental to shipping?
