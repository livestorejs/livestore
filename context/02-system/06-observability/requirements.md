# Observability — Requirements

Defines how LiveStore explains its own runtime behavior: OpenTelemetry
instrumentation of the core layers and dev-time debug affordances. Refines
the transparency requirement of the root ([LS-R13]).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). The devtools
*protocol* (structured inspection/control) is owned by `../07-devtools/`;
this node owns tracing/telemetry semantics.

## Requirements

- **LS.SYS.OBS-R01 OTel-native tracing:** Core operations emit OpenTelemetry
  spans — session/leader boot, commits, materialization, query execution, sync
  push/pull — so app developers can correlate LiveStore behavior with their own
  traces.
- **LS.SYS.OBS-R02 Zero-cost default:** Without an app-provided tracer,
  instrumentation degrades to a no-op with negligible overhead.
  `refines: LS-R14`
- **LS.SYS.OBS-R03 Injectable tracer:** Apps provide their tracer/exporter;
  LiveStore never configures a global exporter on its own.
- **LS.SYS.OBS-R04 Debuggable failures:** Errors carry enough structured
  context (store, client, session identity) to diagnose without reproducing.
  `refines: LS-R13`
