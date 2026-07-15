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
  (LS.SYS.OBS-R02).
- Dev helpers: pretty cause logging (`tapCauseLogPretty`), debug instance
  ids, `__debug*` globals exposed by sessions.

## Open Design Questions

- **LS.SYS.OBS-DQ1 Span naming convention.** Span names exist ad hoc
  (`@livestore/<pkg>:<operation>`); a stated convention and stability policy
  are missing.
- **LS.SYS.OBS-DQ2 Metrics contract.** No metrics are emitted today; whether
  LiveStore should expose counters/histograms (commit rate, rebase count,
  query latency) is undesigned.
