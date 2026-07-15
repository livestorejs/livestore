# Verification — Spec

This document specifies LiveStore's verification architecture. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Lanes

| Lane | Home | Runner |
| --- | --- | --- |
| Unit | `*.test.ts` colocated in packages | Vitest (`mono test unit`) |
| Package integration | `tests/package-common/` | Vitest |
| Browser integration | `tests/integration/` | Playwright (`mono test integration`) |
| Sync-provider conformance | `tests/sync-provider/` | Vitest against `SyncBackend` |
| Perf (store) | `tests/perf/` (test-app + suites) | Playwright (`mono test perf`) |
| Perf (eventlog) | `tests/perf-eventlog/` | Vitest |
| SQLite substrate | `tests/wa-sqlite/` | Vitest |

## Conformance Suites

- **Sync providers** (LS.SYS.VER-R02): `tests/sync-provider/` exercises the
  `SyncBackend` interface directly — connection management, reconnection,
  push/pull ordering, auth failures — so any provider (in-repo or contrib)
  runs the same suite.
- **Adapters / integrations / read models** (LS.SYS.VER-R03): no shared
  suites exist yet; coverage lives in browser integration tests (web) and
  hook tests (react). See LS.SYS.VER-DQ1.

## Performance Evidence

`tests/perf/` measures store operations in a real browser app with a
measurements reporter; `tests/perf-eventlog/` benchmarks eventlog paths.
Devtools protocol compatibility is tested in
`common/src/devtools/devtools-compatibility.test.ts` (LS.SYS.VER-R05);
materializer hash mismatch detection guards determinism (LS.SYS.VER-R06).

Evidence conventions: benchmark results, prototype outcomes, and validation
runs that inform contracts are recorded as `.experiments/` records in the
owning node, per the meta-VRS contract.

## Open Design Questions

- **LS.SYS.VER-DQ1 Missing dimension suites.** Adapter, framework
  integration, and read-model conformance suites (LS.SYS.VER-R03) do not
  exist yet — currently a contract/reality gap for this node.
- **LS.SYS.VER-DQ2 Perf thresholds.** Perf suites measure but do not gate;
  codified budgets/regression thresholds for the LS-R14 claim are undefined.
