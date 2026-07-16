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

## Open Design Questions

- **LS.SYS.VER.PROTO-DQ1 Sync wire compatibility.** Whether the sync
  protocol should gain an explicit wire version plus an executable
  compatibility test (parity with devtools) is undecided; today
  compatibility rests on structural schema decoding alone.
