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
| Sync-provider conformance | Provider contract (see [../02-conformance/](../02-conformance/spec.md)) | `tests/sync-provider/` | Vitest | `mono test sync-provider` | `test-integration-sync-provider` (7-provider matrix) |
| SQLite substrate | wa-sqlite API, session extension, serialize | `tests/wa-sqlite/` | Vitest | `mono test wa-sqlite` | `wa-sqlite-test` |
| Perf (store) | Measurement collection (see [../03-performance/](../03-performance/spec.md)) | `tests/perf/` | Playwright | `mono test perf` | `perf-test` |
| Perf (eventlog) | Event-streaming measurements | `tests/perf-eventlog/` | Playwright | package `test` script | — |
| Examples-as-tests | Examples still build and run | `examples/` | per-example `test` script | `mono examples test` | not a required gate |

## Known Mismatches

Open violations of LS.SYS.VER.LANE-R03, tracked in
[DELTA-002](./.delta/DELTA-002-lane-ci-mismatches.md):

- "Integration" is one local verb but three CI job families
  (sync-provider, playwright suites, wa-sqlite).
- `tests/package-common/` has no dedicated verb; it rides the unit lane
  (hardcoded in `scripts/src/commands/test-commands.ts`).
- Examples-as-tests run only on demand; they are not a required CI gate.

## Coverage Skew

Colocated unit-test counts are heavily skewed toward the engine core
(common 18, livestore 10, utils 7, react 6) while the most swappable
packages have **zero** colocated tests: `adapter-web`,
`adapter-cloudflare`, `sync-cf`, `framework-toolkit`, `wa-sqlite`.
Their coverage rests entirely on the integration and conformance lanes.
Under LS.SYS.VER.LANE-R02 each needs tests or a documented exemption here;
open violation tracked in
[DELTA-001](./.delta/DELTA-001-zero-test-packages.md). No exemptions are
recorded yet.
