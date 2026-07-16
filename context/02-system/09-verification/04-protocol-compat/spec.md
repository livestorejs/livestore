# Protocol Compatibility — Spec

This document specifies protocol-compatibility verification. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Devtools Protocol (captured 2026-07-16)

`packages/@livestore/common/src/devtools/devtools-compatibility.test.ts`
holds three cases:

1. legacy pings without a protocol version are treated as protocol 1;
2. supported protocol versions are accepted independent of package version;
3. unsupported protocol versions are rejected.

This guards the version-handling logic, not message-shape stability across
protocol versions (only protocol 1 exists today).

## Sync Protocol

The sync wire messages (`sync-cf`) carry no protocol version and have **no**
compatibility test; the only versioning is `PERSISTENCE_FORMAT_VERSION`
baked into storage table names (a soft-reset mechanism, not wire compat).
A sync wire-compatibility test is now contracted (LS.SYS.VER.PROTO-R02;
[DELTA-001](./.delta/DELTA-001-sync-wire-compat-missing.md)) — it may force
an explicit wire version, a `03-sync/` design change.
