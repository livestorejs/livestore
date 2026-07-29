# 0002 — Project observed State with run-local Event identity

Status: accepted (maintainer implementation review, 2026-07-20)

## Context

A replay projection must show how backend, Client, Leader-role, and session
State appeared at a selected trace boundary. A distributed run has no
atomically observable global State, and Event sequence numbers identify
Eventlog positions that can change through rebasing. Event fields and current
position therefore cannot always correlate one Event across components.

The trace must remain grounded in actual LiveStore behavior. State inferred
from runner instructions could diverge from the Stores, processors, Eventlogs,
and backend that the Scenario is intended to verify.

## Decision

- Scrubbing selects a monotonic observation index and reconstructs the complete
  accumulated trace prefix. It does not claim an atomic distributed snapshot.
- A profile claiming exact Event lineage assigns a run-local reference over
  actual encoded Event facts and carries it through explicit transition
  mappings. Event fields, positions, and timing alone do not establish lineage.
- Participant hosts observe product transitions. When existing surfaces cannot
  expose a portable fact, the profile advertises that capability limit unless
  the owning subsystem independently justifies a generalized observation seam.

## Consequences

- Component-scoped observations remain separate.
- Correlation without lineage capability is diagnostic, not oracle or causal
  evidence.
- Full projection checkpoints may accelerate seeking but are derived caches.
- Scenario needs alone do not justify a new product Event field.
