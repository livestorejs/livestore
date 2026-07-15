# Event Model — Intuition

*For: contributors touching event definitions or the eventlog · Assumes:
[../intuition.md](../intuition.md) · Covers: why change is modeled as
immutable events and how positions in history work*

## The core bet

LiveStore never stores "the current value" as truth — it stores what
happened. `TodoCreated`, `TodoCompleted` are facts that stay true forever;
current state is just an opinion derived from them. This is why merging two
clients' work is tractable (facts interleave; values would conflict) and why
read-model changes are cheap (reinterpret history instead of migrating it).

## An event is a schema instance

An event definition is a named, versioned schema plus a sync scope. Commit
time is a validation boundary: payloads that don't decode are rejected before
they can enter history. Once appended, history must stay readable forever —
definitions can be deprecated but never removed, and unknown schema hashes
are tolerated on read so old readers survive logs written by newer apps.

## Positions in history

A sequence number is a composite `{global, client, rebaseGeneration}`:

```
e0 ── e1 ── e2 ── e3        global: assigned by the sync backend
              └─ e2.1'      client: local commits after e2, unconfirmed (')
e3 ── e4r1                  r1: that pending event, re-parented by a rebase
```

Only the backend hands out global numbers — a client can never claim a place
in canonical history on its own. Everything a client commits sits in a
provisional tail (`e2.1'`) until confirmed or rebased. The `rN` generation
counts how often that tail was re-parented. The notation is shared by docs,
tests, and debug output, so `e3'` means the same thing everywhere.

## The eventlog is self-describing

Each persisted row carries name, encoded payload, composite position, and
schema hash — enough to detect drift and rebuild all state from scratch.
Append-only means exactly one mutation is ever allowed: re-parenting the
*unconfirmed* tail during rebase. Confirmed history is immutable.

Facts (declarative ordering/conflict constraints) are experimental, and
command replay is a proposal (RFC 0002) — see [spec.md](./spec.md) for their
maturity markers; neither is part of the shipping model.
