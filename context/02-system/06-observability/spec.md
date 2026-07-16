# Observability — Spec

This document specifies LiveStore's telemetry mechanisms. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Mechanisms

- Instrumentation uses `@opentelemetry/api` directly plus the Effect bridge
  (`@livestore/utils/effect` `OtelTracer`); spans are attached via
  `Effect.withSpan` throughout `common` and `livestore` (boot, commit,
  leader sync processing, query paths).
- `common/src/otel.ts` centralizes tracer/span-context plumbing into the
  Store (`StoreOtel`); `createStore`/`provideOtel` inject the app tracer
  (LS.SYS.OBS-R03).
- `utils/src/NoopTracer.ts` is the default when no tracer is provided
  (LS.SYS.OBS-R02). It is cheap but not free: each span allocates a span
  object and reads `performance.now()` at start and end (plus two `cuid()`
  calls if `spanContext()` is consulted). A zero-allocation no-op path on
  the synchronous read path is an aspiration, not current behavior
  (LS.SYS.OBS-DQ3).
- Dev-tracing recipe: `@livestore/utils-dev` `OtelLiveHttp` wires OTLP HTTP
  trace + metric exporters and `logTraceUiUrlForSpan` — the supported way to
  see LiveStore traces in development without the app owning exporter setup.

## Span Inventory

Current span names as emitted (2026-07-16). Four incompatible naming
conventions coexist; bare names (`LiveStore`, `createStore`) can collide
with app spans in a shared trace — evidence for LS.SYS.OBS-DQ1.

| Convention | Examples | Emitting package |
| --- | --- | --- |
| Namespaced `@livestore/<pkg>:<area>:<op>` | `@livestore/common:leader-thread:boot`, `@livestore/common:LeaderSyncProcessor:push`, `@livestore/common:eventlog:getEventsFromEventlog`, `@livestore/common:execSql(Prepared)`, `@livestore/common:migrateTable`, `@livestore/livestore:shutdown`, `@livestore/effect:Store.Tag:<storeId>` | common, livestore |
| Bare generic | `LiveStore`, `LiveStore:<storeId>`, `createStore`, `createStore:boot`, `createStore:makeAdapter`, `LiveStore:commits`, `LiveStore:queries` (long-lived parents), `LiveStore:commit` | livestore |
| Colon-lowercase | `client-session-sync-processor:pull`, `localPushProcessingDelay` | common |
| CamelDot | `StoreRegistry.getOrLoad:<storeId>`, `StoreRegistry.lookup:<storeId>`, `LSD.devtools.onMessage` | livestore |

Test-only spans (`MockSyncBackend:*`) are excluded from the contract.

### Span attributes

Attribute keys currently emitted (unnamespaced unless shown):

| Key | Where | Note |
| --- | --- | --- |
| `sql.query` | `SqliteDbWrapper` query spans | carries full query text — a PII/exposure surface when apps export traces (LS.SYS.OBS-DQ4) |
| `sql.rowsCount`, `sql.cached` | `SqliteDbWrapper` | result size / cache hit |
| `span.label` | leader connection | human label |
| `livestore.manualRefreshLabel` | store manual refresh | only `livestore.`-namespaced key today |
| `batchSize` | leader sync processing, stream-events, store commit | unnamespaced |

## Relationship to devtools

Devtools inspection does **not** consume this telemetry: it reads a parallel
introspection surface (`DebugInfo`, query execution times, reactivity-graph
snapshots) owned by [../07-devtools/](../07-devtools/spec.md), with no OTel
linkage today. Convergence is an open direction.

## Debug Affordances

- `DebugInfo` struct (`common/src/debug-info.ts`): per-session slow-query
  and execution accounting, surfaced over the devtools protocol.
- `__debug*` globals exposed by sessions (`livestore/src/utils/dev.ts`,
  `create-store.ts`) for console poking.
- `tapCauseLogPretty` pretty-prints failure causes; errors carry
  store/client/session identity (LS.SYS.OBS-R04).
- Debug instance ids distinguish parallel store instances.

## Open Design Questions

- **LS.SYS.OBS-DQ1 Span naming convention.** Four incompatible conventions
  coexist (see inventory); bare names collide with app spans. A stated
  convention (`@livestore/<pkg>:<op>`) and stability policy are missing.
- **LS.SYS.OBS-DQ2 Metrics contract.** No metrics are emitted today; whether
  LiveStore should expose counters/histograms (commit rate, rebase count,
  query latency) is undesigned.
- **LS.SYS.OBS-DQ3 No-op overhead budget.** The NoopTracer allocates and
  reads clocks per span on hot paths (issue #1420); whether a
  zero-allocation budget should be contracted (and how to verify it) is
  open.
- **LS.SYS.OBS-DQ4 Attribute contract.** Attribute keys are ad hoc and
  `sql.query` exports query text into app exporters; a namespaced, stability-
  and privacy-classified attribute inventory is missing.
