# DELTA-001 — Notation round-trip is partial

Status: open

## Divergence

LS.SYS.EVT-R10 requires the canonical event-position notation to round-trip
through code, including the unconfirmed marker (`'`) and client prefixes
(`A:`/`B:`) defined in `contributor-docs/events-notation.md`.
`EventSequenceNumber` `toString`/`fromString` emit and parse only the
`e{global}[.{client}][r{gen}]` subset
(`common/src/schema/EventSequenceNumber/client.ts:79,93`); the unconfirmed and
client markers exist in prose, tests, and diagrams but not in code.

## VRS

[requirements.md](../requirements.md) LS.SYS.EVT-R10 (adopted 2026-07-16,
interview); subset reality stated in LS.SYS.EVT-R06.

## Implementation Contract

Extend `toString`/`fromString` (and their property tests) to emit/parse the
`'` unconfirmed marker and optional `A:`/`B:` client prefixes so docs,
tests, and debug output share one executable notation. Close this delta
when round-trip tests cover the full notation.
