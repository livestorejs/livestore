# Verification Lanes — Spec

This document specifies the runnable test lanes. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Lane Taxonomy

| Lane                      | Proves                                                                          | Home                     | Runner                    | Local command                         | CI job                                                                |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------ | ------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| Unit                      | Pure semantics per package                                                      | `*.test.ts(x)` colocated | Vitest                    | `mono test unit`                      | `test-unit`                                                           |
| Package integration       | Cross-package engine behavior (materializer, sync processors, client documents) | `tests/package-common/`  | Vitest                    | folded into `mono test unit`          | `test-unit`                                                           |
| Repo tooling              | `mono` CLI commands (release, docs export, test policy)                         | `scripts/`               | Vitest                    | folded into `mono test unit`          | `test-unit`                                                           |
| Browser integration       | Adapter/devtools behavior in real browsers                                      | `tests/integration/`     | Playwright                | `mono test integration`               | `test-integration-playwright` (suite matrix: misc, todomvc, devtools) |
| Sync-provider conformance | Provider contract (see [../02-conformance/](../02-conformance/spec.md))         | `tests/sync-provider/`   | Vitest                    | `mono test integration sync-provider` | `test-integration-sync-provider` (7-provider matrix)                  |
| SQLite substrate          | wa-sqlite API, session extension, serialize                                     | `tests/wa-sqlite/`       | Vitest                    | `mono test integration wa-sqlite`     | `wa-sqlite-test`                                                      |
| Perf (store)              | Measurement collection (see [../03-performance/](../03-performance/spec.md))    | `tests/perf/`            | Playwright                | `mono test perf`                      | `perf-test`                                                           |
| Perf (eventlog)           | Event-streaming measurements                                                    | `tests/perf-eventlog/`   | Playwright                | package `test` script                 | —                                                                     |
| Examples-as-tests         | Examples still build and run                                                    | `examples/`              | per-example `test` script | `mono examples test`                  | not a required gate                                                   |

## Lane / CI Correspondence

Each lane maps 1:1 to its CI job (LS.SYS.VER.LANE-R03); the table above matches
the actual commands and CI (DELTA-002 resolved 2026-07-17 by correcting the
command column). Two characteristics are deliberate, not drift:

- `mono test integration` is a CLI parent grouping the three integration lanes
  (Browser, Sync-provider, SQLite) — each is still its own row with its own CI
  job.
- `tests/package-common/` and `scripts/` fold into the unit lane
  (`scripts/src/commands/test-commands.ts`) rather than getting separate CI
  jobs, and examples-as-tests run on demand (not a required gate) — all are
  documented in the table above, by design. The unit lane's discovery walks
  `packages/@livestore/*`, `packages/@local/*`, and those two extra roots; a test
  root that is neither in that list nor served by its own lane job runs nowhere in
  CI.

## Test Policy

Test targets invoked through `runTestTarget` state an explicit policy
(LS.SYS.VER.LANE-R04). The policy decision lives in
`scripts/src/shared/test-policy.ts` and the invocations in
`scripts/src/commands/test-commands.ts`; the ledger is
`scripts/src/shared/quarantine-ledger.ts`. Covered: the unit lane, sync-provider, the SQLite
substrate, perf, and the DevTools browser cell. The `misc` and `todomvc` browser
cells and the `mono test integration all` aggregate are not covered — see
[.delta/DELTA-003-integration-lane-unpoliced.md](./.delta/DELTA-003-integration-lane-unpoliced.md).

What a quarantine _means_ is not defined here. `ci-tools quarantine` owns the
entry schema, the expiry rule, and the announcement, so every repo with a ledger
gets the same semantics; this repo declares only which targets are quarantined
(LS.DEL.COMP-R19 and
[../../../03-delivery/01-composition/.decisions/0001-shared-tooling-consumption-channel.md](../../../03-delivery/01-composition/.decisions/0001-shared-tooling-consumption-channel.md)).

| Policy             | Effect on the job                                           |
| ------------------ | ----------------------------------------------------------- |
| `blocking`         | Failures fail the job. The default for every target.        |
| `quarantined(key)` | Failures are announced and tolerated, under a ledger entry. |

`key` must name an entry in `quarantineLedger`, so a quarantine _on this path_
cannot be expressed without a checked-in record of its target, reason, tracking
issue, and expiry date. When the ledger is empty the quarantine constructor is
uninhabited and the type checker rejects any such attempt. The ledger is
TypeScript for exactly that reason; `scripts/src/generated/quarantine-ledger.json`
is generated from it for the CLI, and `lint:check:genie` catches drift between
the two.

The policy governs whole invocations, not individual tests, and it is opt-in.
`it.skip`, `test.todo`, an `exclude` glob, piping `Effect.ignore` onto the
result, or bypassing the helper all still tolerate a failure without a ledger
entry, and none are type errors — see
[.delta/DELTA-004-test-level-suppressions-unledgered.md](./.delta/DELTA-004-test-level-suppressions-unledgered.md).

Two properties keep a quarantine from becoming permanent and invisible:

- **Expiry.** The `quarantine:check` task fails once an entry's `expires` date
  passes, forcing a renew-or-remove decision. It runs via `lint:full`, which the
  `lint` CI job invokes on every pull request, and via `check:quick` /
  `check:all` locally. A malformed date counts as expired.
- **Distinguishable signal.** A tolerated failure appends a line to the job
  summary naming the target, reason, issue, and expiry, and emits a matching
  `::warning::` annotation. Failing to announce fails the run: tolerating a
  failure while losing its signal is the outcome this mechanism exists to
  prevent.

Test selection is resolved against source-of-truth registries rather than by
matching test titles — the sync-provider matrix pins a cell with
`TEST_SYNC_PROVIDER`, validated against `providerRegistry`. A cell therefore
cannot select an empty set, and renaming a suite cannot remove it from CI.

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
