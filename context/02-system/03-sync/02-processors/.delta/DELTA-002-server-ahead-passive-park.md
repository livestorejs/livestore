# DELTA-002 — ServerAhead recovery passively waits for pull publication

Status: open

## Divergence

LS.SYS.SYNC.PROC-R01 requires `ServerAheadError` to trigger an active backend
pull replacement while preserving the unresolved prefix fence. The current
leader push processor instead parks on `Effect.never` and can only resume when
the existing pull path happens to reconcile and restart it
(`packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts`).

If the backend accepted and persisted the preceding push but its pull
publication was lost, another client can advance the backend before the
original leader pushes again. That retry receives `ServerAheadError`, yet the
publication needed to reconcile its stale cursor may never arrive on the
existing pull. Later pending events remain locally materialized but cannot
cross the fenced backend boundary.

Evidence: deterministic incident model and reduction in
[#1462](https://github.com/livestorejs/livestore/issues/1462).

## VRS

Violates [requirements.md](../requirements.md) LS.SYS.SYNC.PROC-R01 and the
active catch-up transition in
[decision 0003](../.decisions/0003-active-server-ahead-catchup.md).

## Implementation Contract

On `ServerAheadError`, keep the rejected backend prefix fenced and request a
fresh pull from the persisted backend cursor. Retire the current pull
generation before starting its replacement, coalesce concurrent requests, and
resume backend pushing only after ordinary pull confirmation or rebase has
reseeded the FIFO from current pending. Add deterministic fault injection that
separates backend push admission from pull publication and proves recovery
without relying on timing or a leader restart.
