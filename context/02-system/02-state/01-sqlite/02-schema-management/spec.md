# SQLite Schema Management — Spec

This document specifies how LiveStore detects SQLite state-schema changes,
selects a state database, and rebuilds derived state. It builds on
[requirements.md](./requirements.md) and the parent [SQLite spec](../spec.md).

## Status

Draft.

## Rebuild Trigger

Schema changes rebuild state through database identity, not by dropping
mismatched tables in place:

1. `makeState` computes one compound fingerprint from every state table,
   including LiveStore's system tables.
2. Adapters include that fingerprint in the persisted state-database name.
   The web adapter uses `state{fingerprint}.db` inside a
   storage-format-versioned directory. The Cloudflare adapter uses
   `state{fingerprint}@{liveStoreStorageFormatVersion}.db`.
3. A different fingerprint therefore opens a fresh, empty state database.
   During leader boot, the absence of state system tables causes `recreateDb`
   to run.

`migrateDb` never drops or clears tables; it uses `create-if-not-exists`.
Eventlog replay does not clear existing rows either. These operations are safe
because the fingerprint change has already selected a fresh database. A
mismatched fingerprint stored inside an existing database does not trigger a
rebuild by itself. The adapter-level database name is the rebuild trigger.

When the web adapter opens the selected state database, it deletes other state
database files. In development it archives up to three old files instead.

## State Fingerprint Contract

LiveStore computes fingerprints synchronously from a canonical descriptor of
the normalized SQLite AST:

- A table fingerprint identifies one table and is stored in
  `__livestore_schema`.
- The compound fingerprint includes all state tables and selects the persisted
  state database.

For each table, the descriptor records:

- The table name and column order.
- Each column's name, SQLite type, primary-key status, nullability,
  autoincrement behavior, and default.
- Each index's name, uniqueness, primary-key status, and ordered columns.

Tables and indexes are treated as unordered collections and sorted with
locale-independent code-unit ordering. Column order within a table or index
remains significant.

For a JSON text column, the descriptor also includes Effect's public
representations of the codec's encoded and type sides. The type side describes
the value represented inside the JSON string. Consequently,
`SqliteDsl.json({ schema })` and
`SqliteDsl.text({ schema: Schema.fromJsonString(schema) })` produce the same
fingerprint without separate schema-provenance metadata.

If `State.SQLite.json()` is used without a schema, its value schema is
`Schema.Any`. Stored row values are never fingerprint input, so changing an
informal JSON shape without changing the declared schema does not trigger a
rebuild.

LiveStore allowlists its own semantic AST fields instead of serializing entire
runtime objects. Compile-time rest-key assertions and exhaustive tag switches
require new LiveStore AST fields to be classified. Within Effect's public
schema representation, LiveStore ignores the generated `annotations` and
`isMutable` fields. Identically named fields inside an application-owned
representation `payload` remain part of the fingerprint. Effect representation
arrays retain their upstream order.

Canonical UTF-8 bytes are digested with one shared synchronous SHA-256
implementation and encoded as an unpadded 43-character base64url string. The
same implementation runs in every adapter. It is internal and has no
application-configurable schema version, algorithm, override, or opt-out. The
base64url encoding retains all 256 digest bits while keeping Cloudflare state
filenames within its SQLite VFS limit.

This contract avoids Effect's private runtime AST shape, but it is not a
complete identity for arbitrary Effect behavior. Effect's public representation
does not identify transformation callbacks, so codecs with the same encoded and
type sides can produce the same fingerprint despite behaving differently. The
same limitation applies to `Schema.declare` callbacks without a public
`representation`.

## Rebuild Sequence

`recreateDb` performs the following operations against the fresh state
database:

1. Run the `init` migration hook.
2. Create state tables and record their table fingerprints.
3. Run the `pre` migration hook.
4. Replay the full eventlog through the current materializers.
5. Run the `post` migration hook.

The rebuild produces a `migrationsReport` surfaced through adapter boot info.
On the Cloudflare Durable Object adapter, replay writes the newly materialized
rows to Durable Object storage and can therefore incur billed row writes.

## Schema-Meta Tables

Two system tables track hashes (`system-tables/state-tables.ts`):

| Table                           | Keyed by    | Tracks                                       |
| ------------------------------- | ----------- | -------------------------------------------- |
| `__livestore_schema`            | `tableName` | textual table fingerprints + `updatedAt`     |
| `__livestore_schema_event_defs` | `eventName` | event-definition schema hashes + `updatedAt` |

Event-definition hashes feed drift detection on read
(`LS.SYS.EVT-R08`); unknown hashes are tolerated so newer-app logs do not
brick older readers.

## State vs Eventlog Versioning — asymmetry

| Mechanism          | State DB                                                      | Eventlog DB                                                                            |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Persisted identity | compound state fingerprint plus storage-format namespace      | `liveStoreStorageFormatVersion`                                                        |
| Schema change      | opens a fresh database and replays the eventlog automatically | **no auto-migration; schema changes without a version bump cause permanent data loss** |
| Recovery source    | eventlog                                                      | none; the eventlog is itself the source of truth                                       |

The eventlog side is guarded only by a code comment
(`eventlog-tables.ts:10`: "NEVER modify eventlog schemas without bumping
`liveStoreStorageFormatVersion`") and a TODO for a proper versioning system.
This asymmetry is the sharpest edge of the schema-management story and is
captured honestly rather than as a guarantee.

## Open Design Questions

- **LS.SYS.STATE.SQLITE.SM-DQ1 Format-bump policy.** What an incompatible
  `liveStoreStorageFormatVersion` bump owes users — refuse to open, migrate,
  export, or the current silent soft-reset/orphaning — is deliberately
  undecided (2026-07-16 interview). Blocked on: a migration/export story
  design.
