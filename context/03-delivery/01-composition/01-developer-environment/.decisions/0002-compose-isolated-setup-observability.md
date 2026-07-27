# 0002 — Compose isolated setup observability from Effect-utils

Status: accepted (2026-07-27, user confirmation; trace evidence in
[experiment 0001](../.experiments/0001-worktree-setup-and-trace.md))

## Context

Setup telemetry has two different regimes. Interactive development benefits
from a persistent queryable backend, while regression tests and benchmarks need
isolated capture with no dependency on ambient collectors, fixed ports, or
ingestion timing. Native devenv tracing emits OTLP/gRPC and Effect-utils task
spans emit OTLP/HTTP.

The profiler runs before dependency materialization is guaranteed, so it cannot
depend on the Node workspace that it is measuring.

## Options

### OTel routing and capture

- **A. Effect-utils auto routing plus isolated otelite capture (chosen).**
  Interactive shells use a configured system stack when present and retain the
  worktree-local stack as fallback. Setup profiling and its E2E contract use
  ephemeral otelite receivers.
- **B. Force the worktree-local stack plus isolated otelite capture.** Smaller
  routing change, but ignores a configured system stack and can route spans to
  local services that were never started.
- **C. Remove the local stack and require system OTel or otelite.** Simplest
  closure, but removes the zero-configuration Grafana/Tempo fallback.

### Effect-utils reuse boundary

- **A. Import the generic Effect-utils observability module (chosen).**
  Effect-utils owns receiver lifecycle, isolated ports, dual-protocol routing,
  capture schemas, and common connected-tree assertions. LiveStore supplies a
  stable project identity and setup profile.
- **B. Compose the otelite CLI directly.** This retains full local control but
  duplicates bootstrap-safe shell and Nix orchestration across repositories.
- **C. Run the typed `@overeng/utils-dev/otelite` harness.** This gives typed
  Effect assertions, but depends on the Node workspace whose materialization is
  itself part of the setup path being profiled.

### Performance enforcement

- **A. Deterministic trace contract only (chosen).** CI verifies capture
  integrity, task parentage, rejection count, and process outcome. Benchmark
  timings remain experiment evidence because Nix cache and host state materially
  affect absolute duration.
- **B. Absolute CI duration ceiling.** This can catch severe regressions, but
  makes correctness depend on runner and cache conditions.
- **C. Non-blocking trend lane.** This enables longitudinal analysis, but adds
  CI and dashboard scope beyond the setup correction.

## Decision

Choose A for all three axes. Interactive routing follows Effect-utils auto
detection; otelite owns deterministic setup capture. The shared observability
module composes otelite's machine-first CLI rather than redefining capture or
inspection. LiveStore configures the reusable setup profile and keeps
domain-specific performance interpretation in its experiment record.

## Consequences

- Native devenv tracing owns evaluation, scheduling, and task lifecycle;
  Effect-utils task spans refine the matching native task span.
- The E2E assertion requires one connected trace and rejects an Effect-utils
  task span that becomes an independent root.
- The bootstrap path does not depend on `node_modules`; typed otelite helpers
  remain the preferred test integration once dependency materialization is
  already available.
- Repositories share one bootstrap-safe profiler implementation; adoption does
  not require importing the full Collector/Tempo/Grafana stack.
- CI does not fail on an absolute setup duration. Reproducible benchmark method
  and measured results stay in the experiment record.
- Local captures may contain machine-local command metadata. They stay under
  ignored `tmp/` storage and are not uploaded automatically.
