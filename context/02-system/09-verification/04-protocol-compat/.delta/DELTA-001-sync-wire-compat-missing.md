# DELTA-001 — Sync wire-compatibility test not built

Status: open

## Divergence

LS.SYS.VER.PROTO-R02 requires an executable test failing on undeclared
breaking sync wire changes. None exists: the wire messages
(`sync-cf/src/common/sync-message-types.ts` and per-transport RPC schemas)
carry no protocol version, and the only versioning mechanism is
`PERSISTENCE_FORMAT_VERSION` baked into storage table names (a soft-reset
mechanism, not wire compatibility).

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.PROTO-R02 (adopted
2026-07-16, interview).

## Implementation Contract

Snapshot the wire message schemas (or their structural fingerprints) and
assert new code still decodes prior-version fixtures; likely requires
introducing an explicit wire version field first (a `03-sync/` design
change — coordinate there). Close when the test runs in CI and fails on an
undeclared breaking schema change.
