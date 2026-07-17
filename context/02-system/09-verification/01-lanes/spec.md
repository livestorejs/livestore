# Verification Lanes — Spec

This document specifies the runnable test lanes. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Lane Taxonomy

| Lane | Proves | Home | Runner | Local command | CI job |
| --- | --- | --- | --- | --- | --- |
| Unit | Pure semantics per package | `*.test.ts(x)` colocated | Vitest | `mono test unit` | `test-unit` |
| Package integration | Cross-package engine behavior (materializer, sync processors, client documents) | `tests/package-common/` | Vitest | folded into `mono test unit` | `test-unit` |
| Browser integration | Adapter/devtools behavior in real browsers | `tests/integration/` | Playwright | `mono test integration` | `test-integration-playwright` (suite matrix: misc, todomvc, devtools) |
| Sync-provider conformance | Provider contract (see [../02-conformance/](../02-conformance/spec.md)) | `tests/sync-provider/` | Vitest | `mono test integration sync-provider` | `test-integration-sync-provider` (7-provider matrix) |
| SQLite substrate | wa-sqlite API, session extension, serialize | `tests/wa-sqlite/` | Vitest | `mono test integration wa-sqlite` | `wa-sqlite-test` |
| Perf (store) | Measurement collection (see [../03-performance/](../03-performance/spec.md)) | `tests/perf/` | Playwright | `mono test perf` | `perf-test` |
| Perf (eventlog) | Event-streaming measurements | `tests/perf-eventlog/` | Playwright | package `test` script | — |
| Examples-as-tests | Examples still build and run | `examples/` | per-example `test` script | `mono examples test` | not a required gate |

## Lane / CI Correspondence

Each lane maps 1:1 to its CI job (LS.SYS.VER.LANE-R03); the table above matches
the actual commands and CI (DELTA-002 resolved 2026-07-17 by correcting the
command column). Two characteristics are deliberate, not drift:

- `mono test integration` is a CLI parent grouping the three integration lanes
  (Browser, Sync-provider, SQLite) — each is still its own row with its own CI
  job.
- `tests/package-common/` folds into the unit lane
  (`scripts/src/commands/test-commands.ts`) rather than getting a separate CI
  job, and examples-as-tests run on demand (not a required gate) — both are
  documented in the table above, by design.

## Coverage Skew

Colocated unit-test counts are heavily skewed toward the engine core
(common 18, livestore 10, utils 7, react 6) while four swappable packages have
**zero** colocated tests: `adapter-web`, `adapter-cloudflare`, `sync-cf`,
`framework-toolkit`. Their coverage rests entirely on the integration and
conformance lanes. Under LS.SYS.VER.LANE-R02 each needs tests or a documented
exemption here; open violation tracked in
[DELTA-001](./.delta/DELTA-001-zero-test-packages.md).

**Exemption:** `wa-sqlite` — a vendored fork with its own 13 test files and a
dedicated substrate lane (`wa-sqlite-test`); its colocated coverage is the
vendored suite, so it is not counted as silently untested.
