# Determinism Verification — Spec

This document specifies determinism verification. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## What Exists (captured 2026-07-16)

- **Runtime guard, not a test:** the session/leader materializer-hash
  comparison (`MaterializerHashMismatchError`) runs in dev mode during
  normal operation — see `../../02-state/01-sqlite/spec.md`.
- **Materializer unit tests:** `tests/package-common/src/materializer.test.ts`
  asserts materializer *outputs* (`toMatchObject`), not hashes.
- Sync-merge semantics are covered by example-based unit tests
  (`syncstate.test.ts`) in the `e{n}` notation.

## What Does Not Exist

- No rematerialize-twice oracle (rebuild the same eventlog twice, assert
  identical state).
- No cross-adapter or cross-SQLite-build equivalence check (same eventlog →
  same state hash on wa-sqlite vs node builds, web vs cloudflare adapters).
- No property-based coverage for merge/rebase/sequence-number semantics
  (`@effect/vitest` is available but unused generatively).

## Open Design Questions

- **LS.SYS.VER.DET-DQ1 Property-based coverage.** The oracle is decided
  (rematerialize-twice + cross-build hash equivalence, LS.SYS.VER.DET-R02);
  whether merge/rebase/sequence-number semantics additionally warrant
  property-based generative tests remains open.
