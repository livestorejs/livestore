# Developer Environment — Spec

This document specifies shell readiness and setup diagnostics. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: automatic shell setup, explicit source-validation gates, setup
profiling, and local trace handling. Does not define: the shared Effect-utils
implementation, CI workflow composition, or production observability.

## Shell Readiness

Shell entry establishes dependency and generated-source readiness through
`pnpm:install` and `genie:run`. It does not run the full TypeScript build.
TypeScript validation remains an explicit `ts:build` / `ts:check` gate in
developer and CI workflows, so source errors cannot delay or block access to
the diagnostic environment
([decision 0001](./.decisions/0001-separate-readiness-from-validation.md)).

The shared setup gate computes one repository-input fingerprint and exports its
cache verdict to every downstream status probe. Instrumentation must preserve
those task exports across its process boundary. A warm verdict only selects the
bounded pnpm projection and generated-output existence checks; it does not
bypass them. Dirty lockfiles, missing or broken dependency projections, and
missing generated outputs remain cache misses.

## Setup Observability

`otel:profile:setup` is the canonical setup diagnostic. The shared Effect-utils
observability module runs the strict setup graph under devenv's native
`--trace-to` instrumentation and captures both native devenv spans and
Effect-utils task spans with `otelite`. Native spans own evaluation, scheduling,
and task lifecycle; Effect-utils spans refine the task execution beneath the
matching native task span. `otel:verify:setup` runs the bounded `setup:gate`
shape proof and is part of `check:all`.

Interactive telemetry uses Effect-utils automatic system-stack detection with
the worktree-local stack as fallback. Deterministic setup profiling uses
otelite's ephemeral HTTP and gRPC receivers. Effect-utils owns the
bootstrap-safe dual-transport lifecycle and common connected-tree assertions;
LiveStore configures its stable project identity and setup profile. Otelite
remains the source of truth for capture, schemas, and normalized inspection
([decision 0002](./.decisions/0002-compose-isolated-setup-observability.md)).

The E2E contract asserts a successful child, no rejected telemetry, one trace,
the native root and task spans, and the native `setup:gate` to Effect-utils
`devenv.task.exec` parent relationship. It does not enforce absolute duration.
Benchmark timings remain experiment evidence because host and cache state are
material inputs
([experiment 0001](./.experiments/0001-worktree-setup-and-trace.md),
[experiment 0002](./.experiments/0002-traced-task-export-propagation.md)).

Setup captures are local diagnostic artifacts under the ignored `tmp/` tree.
They are not uploaded automatically. This keeps machine-local paths and command
metadata in a private-by-default evidence lane while stable task names,
outcomes, cache decisions, and durations remain queryable.
