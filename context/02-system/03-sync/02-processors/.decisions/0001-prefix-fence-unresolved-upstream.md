# 0001 — Fence unresolved upstream prefixes before sending later events

Status: accepted (SF-03 reduction evidence and maintainer confirmation,
2026-07-31).

## Context

The merge core confirms pending events by matching an incoming prefix. SF-03
showed a client session with pending `[A, B]` receiving `B` from its leader at
an earlier sequence position. Positional divergence at `A` caused merge to
schedule incoming `B` plus rebased `[A, B]`, materializing `B` twice.

The processor schedule permits this state after an older push is rejected: the
session records the rejection and clears its queue, but a later local commit can
enqueue and send only its new event before pull reconciliation reconstructs the
full pending prefix. The leader accepts monotonically newer batches without a
per-session fence for the unresolved generation.

The required atomicity is a protocol transition: no later pending event becomes
admissible upstream between rejection and reconciliation. It is not a database
transaction spanning the session, leader, and backend.

## Options

- **(a) Fence later upstream propagation until the unresolved prefix is
  reconciled — chosen.** Local commits continue to materialize and append to
  pending. The background driver pauses sending at that boundary. Pull either
  confirms an accepted prefix or rebases the full remaining suffix; the driver
  then reseeds from current pending and resumes in FIFO order. Apply the same
  invariant at session→leader and leader→backend.
- **(b) Give events immutable IDs and teach merge to recognize non-positional
  overlap.** Valuable as a possible idempotency hardening, but it expands the
  event envelope, wire protocol, persistence format, and merge semantics. It is
  not required to prevent the processor from creating the invalid non-prefix
  transition.
- **(c) Block `store.commit()` behind push/rebase ownership.** Rejected because
  upstream propagation is asynchronous and must not suspend the synchronous
  local commit path (LS.SYS.STORE-R04).
- **(d) Deduplicate by event name/args or application primary key.** Rejected:
  repeated identical commits are valid, and application-level upsert/ignore
  would hide sync corruption rather than preserve event semantics.

## Consequences

- Confirmed/pending overlap remains possible while acknowledgement propagates,
  but it must be prefix-aligned and is therefore mergeable without duplicate
  materialization.
- Rejection and uncertain-result handling become explicit processor states;
  later commits accumulate locally without crossing the fenced boundary.
- This is a drain-gating rule, not a requirement to replace the FIFO queue. The
  existing queue type can remain if its single worker cannot drain while the
  boundary is fenced.
- Upstream admission must accept or reject a batch as a unit and acknowledge
  only after admission completes. Defensive generation/session fencing at the
  receiver prevents a buggy downstream from bypassing its prefix.
- The existing leader→backend `ServerAheadError` path already approximates the
  chosen state machine by parking until pull interrupts and reseeds it. The
  client-session rejection path is the tracked implementation gap.
