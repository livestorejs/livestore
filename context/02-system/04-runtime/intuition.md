# Runtime — Intuition

*For: contributors touching adapters, workers, or the leader lifecycle ·
Assumes: [../intuition.md](../intuition.md) · Covers: why one writer per
client, and what an adapter actually is*

## One writer, many optimistic readers

Per client there is exactly one leader — the only context allowed to *write*
the persisted eventlog, the persisted state database, and drive the upstream
connection. Every client session (tab, view, embedding) holds a private
in-memory replica for synchronous reads and proxies every durable effect to
the leader. (One deliberate shortcut: on web a booting session may read the
persisted state DB directly — the fast path — but writing stays
leader-only.) This is the classic single-writer principle: concurrency
questions ("two tabs committed at once") become ordering questions at one
queue instead of file-locking questions at the storage layer.

```
session A ─┐
session B ─┼─ proxy ─▶ leader ─▶ persisted eventlog + state ─▶ backend
session C ─┘                    (the only writer)
```

## The leader is a role, not a place

Leadership is elected, observable (`lockStatus`), and transferable. The
crucial design consequence: a new leader inherits *nothing* from the old one
— it rehydrates entirely from the persisted eventlog (upstream head from a
system table, pending = everything after it). Handover safety therefore
reduces to "was it persisted?", never "did the message arrive?". Kill a
leader mid-flight and the next one re-derives the same pending queue.

## An adapter is a topology recipe

The layers above this node are pure TypeScript with no idea where they run.
An adapter answers the platform questions: which context hosts the leader,
how contexts talk (webmesh channels over ports/workers/websockets), which
VFS backs SQLite (OPFS on web, DO storage on Cloudflare), how leadership is
locked, how shutdown propagates. Web spreads roles across
tab/shared-worker/leader-worker ([01-web/](./01-web/spec.md), decomposed
into persistence/topology/leadership children); Cloudflare collapses them
into one Durable Object ([02-cloudflare/](./02-cloudflare/spec.md)). Same
roles, different floor plans.

Two substrates keep adapters honest: webmesh
([03-webmesh/](./03-webmesh/spec.md)) makes messaging platform-agnostic,
and the single WASM SQLite build makes materialization bit-identical
everywhere — an adapter chooses *where*, never *what*.
