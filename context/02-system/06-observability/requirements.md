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
- **LS.SYS.OBS-R02 No-op default:** Without an app-provided tracer,
  instrumentation degrades to a built-in no-op tracer: no exporter, no
  network, bounded per-span overhead (today: one object allocation plus
  start/end timestamps — a stricter zero-allocation budget is open, see
  LS.SYS.OBS-DQ3). `refines: LS-R14`
- **LS.SYS.OBS-R03 Injectable tracer:** Apps provide their tracer/exporter;
  LiveStore never configures a global exporter on its own.
- **LS.SYS.OBS-R04 Debuggable failures:** Errors carry enough structured
  context (store, client, session identity) to diagnose without reproducing.
  `refines: LS-R13`
- **LS.SYS.OBS-R05 Span namespacing:** Every LiveStore-emitted span name is
  prefixed `@livestore/<pkg>:`; no bare names (`LiveStore`, `createStore`)
  that can collide with app spans in a shared trace. Grep-testable. Adopted
  2026-07-16 (interview); four conventions coexist today — see
  [.delta/DELTA-001-span-naming-conventions.md](./.delta/DELTA-001-span-naming-conventions.md).
  `refines: LS-R13`
- **LS.SYS.OBS-R06 Attribute contract:** Span attribute keys are namespaced
  and enumerated in the spec's attribute inventory; attributes carrying query
  text (`sql.query`) are gated behind a debug flag and absent by default.
  Adopted 2026-07-16 (interview); keys are ad hoc and `sql.query` is ungated
  today — see
  [.delta/DELTA-002-attribute-contract-gaps.md](./.delta/DELTA-002-attribute-contract-gaps.md).
  `refines: LS-R13`
