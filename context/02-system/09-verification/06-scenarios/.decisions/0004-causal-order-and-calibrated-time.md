# 0004 — Separate causal order from calibrated elapsed time

Status: accepted (maintainer implementation review, 2026-07-21)

## Context

Observation order can serialize independent propagation branches, while a
causal-stage view can conceal operational delay. Contributors need both the
dependency structure and elapsed-time offsets without introducing timestamps
into LiveStore synchronization semantics.

## Decision

The canonical Scenario trace represents a causal partial order, not a global
total order. Participant-local sequence and explicit instruction,
acknowledgement, boundary-transition, dependency, and causation records are the
ordering evidence. Correlation associates records but creates no edge.

Profiles comparing cross-process time record Participant-local monotonic time
and calibration evidence sufficient to estimate a shared Scenario-time
interval with explicit uncertainty. Timestamp proximity, Event-field equality,
and Observation-capture membership never create causal edges.

Visualization provides causal-flow and elapsed-time projections over the same
immutable records. Flow may align sibling propagation branches while retaining
latency evidence. Elapsed-time layout uses calibrated intervals and does not
force overlapping intervals into a total order.

## Consequences

- A Scenario observation capture is useful for grouping and scrubbing but is
  never presented as an atomic moment.
- The same causal stage does not mean simultaneous.
- Exact receive/apply latency is available only when both transitions are
  instrumented.
- Timing that contradicts a known causal edge beyond its uncertainty is an
  instrumentation defect.
