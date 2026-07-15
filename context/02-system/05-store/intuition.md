# Store — Intuition

*For: contributors touching the Store or reactivity internals · Assumes:
[../intuition.md](../intuition.md) · Covers: why reads are synchronous and
how the reactivity graph stays glitch-free*

## The store is the whole engine behind one object

Apps see one surface per `storeId`: `query`, `subscribe`, `commit`,
lifecycle. Everything else — eventlog, materializers, sync, leader — hides
behind it. The two promises that define the surface:

- **Reads never wait.** `store.query` runs against the session's in-memory
  SQLite synchronously — no promise, no loading state. This is what "local
  source of truth" feels like in API shape.
- **Writes feel instant.** `commit` validates, materializes locally in one
  transaction, refreshes affected queries, and returns. Persistence and sync
  happen behind the scenes via the leader.

## The reactivity graph: a spreadsheet over SQLite

Queries, computeds, and signals form one dependency graph; commits mark the
table refs they wrote. Its guarantees are easiest to remember as
"spreadsheet semantics":

- **Eager and synchronous** — recalculation happens before the write call
  returns; there is no scheduler (Adapton-inspired, minus the laziness).
- **Atomic per commit** — one commit = one refresh pass, however many
  tables it touched.
- **Glitch-free** — refresh runs in topological order, so a formula never
  sees a mix of old and new inputs.
- **Cutoff** — unchanged results stop propagation, keeping refreshes
  proportional to what actually changed.

When you wonder "can a subscriber observe an intermediate state?", the
answer is designed to be no — and the escape hatches (`skipRefresh`,
`batchUpdates`) are explicit opt-outs, not accidents.

## Many stores, counted references

Multi-store apps (one store per project/workspace/document) go through the
`StoreRegistry`: integrations acquire and release, reference counts drive
shutdown, and intentional shutdown stays distinguishable from failure.

The commit-receipt proposal (awaitable leader/backend confirmation) is not
shipped — see LS.SYS.STORE-DQ1 in [spec.md](./spec.md).
