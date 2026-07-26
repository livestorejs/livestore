# 0002 — Remove the implicit client-document API

Status: accepted (RFC 0003; implementation tracked by
[issue #1481](https://github.com/livestorejs/livestore/issues/1481)).

## Context

The SQLite realization exposed a special document table that generated its
event, materializer, default-row behavior, and React setter API. A query of a
missing document could commit its default event before executing the read.
That mixed schema declaration, mutation design, and query execution while
hiding state ownership and event semantics.

RFC 0003 was accepted to restore one explicit state model and remove the
special cases throughout schema assembly, querying, and framework bindings.

## Options

- **(a) Remove the API and use ordinary primitives — chosen.** Applications
  define normal SQLite tables, synced or client-only events, materializers,
  and read-only queries explicitly. A query fallback may represent a missing
  row in memory; the first edit creates it through an explicit event/upsert.
- **(b) Retain a deprecated compatibility layer.** Rejected because it would
  preserve hidden event registration and read-time writes.
- **(c) Replace it with another generic document helper.** Rejected for this
  change; convenience abstractions must prove a separate contract without
  reintroducing implicit mutation behavior.

## Evidence

Design evidence: [RFC 0003](../../../../../contributor-docs/rfcs/0003-remove-client-document-api.md).
Implementation evidence: removal of the client-document table definition,
`RowQuery`, first-read commit path, React hook, and toolkit setter helpers;
repository examples exercise ordinary tables plus explicit client-only
events.

## Consequences

- SQLite schema assembly registers only explicitly supplied application
  events and materializers.
- Queries only read. Missing-row defaults use an in-memory fallback and do
  not append an event.
- UI-state scope is visible in its table key and event payload.
- `Events.clientOnly()` and `SessionIdSymbol` remain available independent
  primitives.
- No compatibility alias, migration layer, or replacement public helper is
  introduced.
- Requirements `LS.SYS.STATE.SQLITE-R03`, `LS.SYS.STATE.SQLITE-R07`, and
  `LS.SYS.INT-R06` are retired and must not be reused.
