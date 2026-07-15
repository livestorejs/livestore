# System — Intuition

*For: new contributors to the engine · Assumes: the product-level model from
[../intuition.md](../intuition.md) · Covers: how the nine system subsystems
compose*

## One sentence per layer

Events describe what happened; the eventlog remembers it; materializers turn
it into queryable state; sync makes every client's log converge; the runtime
decides where each piece executes; the store hands it all to the app as one
synchronous, reactive surface.

## The composition

```
   08-integrations   framework idioms over the store
   05-store          commit + synchronous queries + reactivity
   ─────────────────────────────────────────────────
   01-event-model    what change *is*        (events, eventlog)
   02-state          what change *does*      (materializers → state)
   03-sync           how change *converges*  (push/pull/rebase)
   ─────────────────────────────────────────────────
   04-runtime        where it all runs       (leader/session, adapters)

   06-observability explains it · 07-devtools inspects/controls it ·
   09-verification proves it
```

The numbering is the dependency direction: everything below a line knows
nothing about what sits above it. The event model needs no notion of state;
state derivation needs no notion of sync; none of the three care whether
they run in a browser tab, a worker, or a Durable Object.

## The two boundaries that matter

Every interesting runtime question is about one of two edges: the
**session ⇄ leader** edge (many optimistic in-memory replicas, one persisted
writer) and the **leader ⇄ backend** edge (many clients, one ordering
authority). The same sync-state machine runs at both — once you understand
"pending events waiting to be confirmed by upstream," you understand both
edges; only the transport differs.

## Why the seams are contracts

State realizations, sync providers, adapters, framework integrations, and
devtools surfaces are deliberately pluggable (root
[requirements.md](../requirements.md) LS-R07…R10): the core states each
contract once, realizations refine it, and `09-verification/` owns the
suites a realization must pass. When you add a
platform or provider, you implement a contract — you never touch the layers
above the line.

For precision, start at [requirements.md](./requirements.md) and
[spec.md](./spec.md), then descend into the child that owns your question.
