# 0003 — Actively replace backend pull after ServerAhead

Status: accepted ([#1462](https://github.com/livestorejs/livestore/issues/1462)
reduction evidence and maintainer direction, 2026-08-21).

## Context

The backend can durably accept a push while the corresponding pull publication
never reaches that leader. If another client then advances the backend, the
original leader's next push starts from a stale parent and receives
`ServerAheadError`. The push processor correctly preserves its unresolved
prefix, but passive parking assumes that its existing pull will eventually
deliver the missing history. That assumption is not guaranteed after a lost
publication, so an otherwise healthy leader can stop propagating later pending
events permanently.

The processor already persists an authoritative backend cursor and can rebuild
its backend-push FIFO after pull confirmation or rebase. The missing transition
is an active way to obtain history after `ServerAheadError` without weakening
the prefix fence or depending on provider-specific server state.

## Options

- **(a) Replace the processor-owned backend pull from its persisted cursor —
  chosen.** `ServerAheadError` requests catch-up, the current pull generation is
  retired, and one replacement pull is started from the newly read persisted
  cursor. The rejected push remains fenced until pull confirms or rebases it.
- **(b) Keep parking until the current pull publishes something.** Rejected:
  the publication that would wake the processor may be the event already lost,
  leaving no future traffic guaranteed to arrive.
- **(c) Ask the provider to replay from the rejected push's reported backend
  head.** Rejected as the core recovery mechanism: the reported head is not
  event history, provider metadata is opaque, and provider-targeted replay
  would expand the wire contract and adapter responsibilities.
- **(d) Treat an exact duplicate push as an acknowledgement.** Deferred as
  independent protocol hardening. It can reduce ambiguity for a retried
  accepted batch, but it does not recover intervening history or replace
  pull-based confirmation of the complete pending prefix.

## Consequences

- The processor, not a specific sync-provider adapter, owns recovery from the
  shared `ServerAheadError` contract.
- The persisted backend cursor remains authoritative. A server-head value in
  the error is only evidence that catch-up is required.
- Pull replacement has a single owner: the old generation is retired before
  the next starts, and concurrent replacement requests coalesce.
- Backend pushing remains fenced until normal pull merge confirms or rebases
  the unresolved prefix; catch-up never skips the merge core.
- Provider publication guarantees, typed transport outcomes, and duplicate
  acceptance can be strengthened separately without being prerequisites for
  forward progress here.
