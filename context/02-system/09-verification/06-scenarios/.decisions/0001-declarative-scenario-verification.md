# 0001 — Declarative, production-shaped Scenario verification

Status: accepted (maintainer migration direction, 2026-07-29; tracked in
livestorejs/livestore#1517)

## Context

Focused unit, integration, conformance, determinism, and performance tests do
not provide one reproducible way to exercise the complete sync system across
multiple Clients and sessions, changing topology, faults, Recovery,
materialization, and runtime boundaries. Scenario verification must produce
portable correctness evidence without replacing the components it verifies.

## Options

- **Declarative typed Scenarios with a versioned serializable AST (chosen).**
  Effect Schema-backed TypeScript constructors preserve inference while making
  control, time, randomness, faults, and oracles inspectable. Arbitrary
  orchestration callbacks cannot be validated or visualized uniformly.
- **Production-shaped profiles behind capability contracts (chosen).** A
  profile claiming composed evidence runs real Stores, processors,
  materializers, and selected runtime/State boundaries. A pure merge model is
  useful subordinate evidence but not a substitute.
- **Headless authority behind a normalized trace (chosen).** Oracles, artifacts,
  live visualization, and replay consume the same semantic trace. Execution
  does not depend on a dashboard.

## Decision

Adopt the three constraints above as the core Scenario contract. Runner,
Participant-host, backend, and viewer realizations may evolve independently
only while preserving Scenario semantics and the serializable control, trace,
and artifact boundaries.

Evidence: the implementation history behind
[RFC review #1442](https://github.com/livestorejs/livestore/pull/1442) and the
maintainer's 2026-07-29 direction to retain the mechanism-independent contract
while migrating its realization to `livestore-contrib`.

## Consequences

- Product packages never depend on a Scenario realization.
- Exact realization APIs, profiles, fault seams, trace retention, and viewer
  interaction belong to contrib implementation intent.
- Core subsystem changes require independent product justification and the
  smallest generalized testing seam.
