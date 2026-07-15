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
    derived: TDerived              // derived events have no materializers
    deprecated: string | undefined // warn-at-commit (LS.SYS.EVT-R04)
  }
  (args: TType): { name; args }    // callable → partial event for commit()
}
```

Definitions are created via `Events.synced(...)` / `Events.clientOnly(...)`
and collected in an `EventDefRecord` on the store schema. Client-document
tables (`02-state/01-sqlite/`) auto-generate derived client-only set-events
with implicit materializers.

## Event Shapes

| Shape | Used | Content |
| --- | --- | --- |
| Partial event | `store.commit()` input | `{name, args}` from calling an EventDef |
| `LiveStoreEvent.Client` | session/leader, eventlog | + composite seqNum, clientId, sessionId, meta |
| `LiveStoreEvent.Global` | sync backend wire/stored | + global seqNum; the upstream-visible encoding |

All shapes are Effect Schema structs; encoding happens at the boundary
(LS.SYS.EVT-R03).

## Sequence Numbers

`EventSequenceNumber.Client.Composite = { global, client, rebaseGeneration }`.

- `global` — assigned by the sync backend; monotonically increasing; the
  canonical order (LS.SYS.EVT-R05).
- `client` — local counter for events committed between two global
  positions (`e5.1` = first local event after `e5`).
- `rebaseGeneration` — increments when the client rebases (`e3r1`).

Notation (`contributor-docs/events-notation.md`): `e0`, `e3'` (unconfirmed),
`e5.1` (client-local), `e3r1` (after rebase).

## Eventlog

The leader persists events in system tables (`eventlog-tables.ts`:
eventlog meta, sync status head). Properties:

- Append-only; confirmed history is immutable (LS.SYS.EVT-R07). Pending
  events may be re-parented by rebase (`03-sync/`).
- Each row stores the event name, encoded args, composite sequence number,
  and schema hash — sufficient for drift detection and full rebuild
  (LS.SYS.EVT-R08). Unknown schema hashes are tolerated on read
  (`UNKNOWN_EVENT_SCHEMA_HASH`) so logs written by newer app versions do not
  brick older readers.
- `getEventsSince(seqNum)` streams the tail for session catch-up and
  rebase rollback (with session changesets from the state DB).

## Facts

**Maturity: experimental** (`schema/EventDef/facts.ts` is marked
not-fully-implemented). Facts are key/value constraints an event can
`set`/`unset`/`require`/`read`, enabling ordering constraints, compaction,
and conflict detection. Consumed by the experimental next-gen sync
(`../03-sync/spec.md`). Not part of the shipping contract.

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
