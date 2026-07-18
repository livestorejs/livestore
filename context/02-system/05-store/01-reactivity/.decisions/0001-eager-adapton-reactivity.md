# 0001 — Signals-based eager reactivity (Adapton vocabulary, no laziness)

Status: accepted (founding decision; recorded 2026-07-16 from documented
history and code).

## Context

Query results must be consistent with a commit the moment it returns
(synchronous read path, LS-R12/LS-R14), while avoiding needless
recomputation across a graph of dependent queries.

## Options

- **(a) Eager signals graph with topological refresh and equality cutoff —
  chosen.** Ref updates refresh the graph synchronously in topological
  order (heights maintained eagerly); each thunk compares against its
  previous value and cuts off propagation. Terminology comes from the
  MiniAdapton paper.
- **(b) Full MiniAdapton (lazy/demand-driven recomputation).** Rejected
  explicitly in code: "we don't actually implement the MiniAdapton
  algorithm because we don't need lazy recomputation" (`reactive.ts`
  header) — the synchronous read guarantee makes eager refresh the fit.
- **(c) Off-the-shelf signal libraries.** No evaluation is documented;
  undocumented whether any was considered.

## Evidence

Code: `packages/@livestore/livestore/src/reactive.ts` header (design notes
and the explicit non-implementation of laziness). Documented history:
`docs/understanding-livestore/design-decisions.md` ("Signals-based
reactivity system based on the ideas of Adapton"). Contract form: the
graph guarantees in [spec.md](../spec.md) §Graph Update Guarantees.

## Consequences

- Every commit pays an eager refresh pass; cutoff (schema equivalence)
  bounds downstream work — and `map` on a query disables that cutoff
  (LS.SYS.STORE.RX-R05).
- No scheduler/microtask deferral exists; framework bindings integrate via
  subscription, not via the graph's timing.
