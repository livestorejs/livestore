# 0002 — Track leader push reservations until terminal processing

Status: accepted (browser/local-sync-cf reduction and deterministic barrier
regression, 2026-08-01).

## Context

The leader prefix fence previously stored only the maximum sequence position.
It advanced before queue publication and did not own a concrete reservation.
Interruption, queue rejection, stale-generation dropping, or a pull between
queue take and local merge could therefore leave either a ghost suffix or an
unfenced in-flight batch. With two sessions sharing one leader, later rebased
pushes could be rejected forever even though the leader had zero pending work.

Rebase generations are local epochs rather than part of the global/client DAG
position. A confirmed leader head and a session head can legitimately use
different generations for the same parent position.

## Decision

Leader admission serializes validation, reservation, and queue publication in
one uninterruptible critical section. Every admitted queue item remains in an
explicit reservation set after the drain worker takes it. Processing releases
the reservation only when the item is applied, dropped as stale, or rejected.
Pull reconciliation combines its authoritative head with remaining compatible
reservations instead of inferring ownership from a queue snapshot.

Contiguity requires exact event sequence numbers but compares parent
global/client position independently of rebase generation. Stale-generation
checks remain explicit and prevent older epochs from crossing the fence.

## Consequences

- Queue take no longer makes in-flight work temporarily invisible to admission.
- Rejected and dropped batches cannot retain a ghost prefix fence.
- A newer session generation can continue from the same confirmed parent
  position without waiting for an unrelated future pull.
- Test-only admission hooks support deterministic barriers without adding
  production scheduling delays.
