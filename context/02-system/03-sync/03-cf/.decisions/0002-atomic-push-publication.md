# 0002 — Serialize push admission through pull publication

Status: accepted (browser/local-sync-cf transition trace and deterministic
barrier regressions, 2026-08-01).

## Context

Concurrent Effect RPC fibers could construct distinct Durable Object context
services during first use. Each service carried its own cached head and lock,
so two pushes sharing a parent could both pass validation and race to insert the
same global positions. The loser surfaced a SQLite uniqueness error rather than
the protocol's `ServerAheadError`.

Even after storage admission was serialized, the request remained interruptible
between committing a new head and starting its background pull broadcast. A
leader rebase could interrupt the winning request in that gap. The backend then
advanced without publishing the accepted event, while every subsequent pusher
received `ServerAhead` and parked waiting for a pull that could never arrive.

## Decision

Durable Object context construction is single-flight per instance, producing
one shared head reference and push semaphore. The semaphore serializes the full
admission transition: validate parent, persist events, advance the head, and
publish the corresponding pull response in order. Once persistence begins,
that transition is uninterruptible through publication.

## Consequences

- Same-parent contenders produce exactly one success; all other contenders see
  `ServerAheadError`, not storage errors.
- A committed head always has an ordered pull publication before the next push
  is admitted.
- Push acknowledgement may wait for subscriber publication rather than merely
  storage commit. This intentionally favors protocol liveness over the former
  background-ack latency optimization.
