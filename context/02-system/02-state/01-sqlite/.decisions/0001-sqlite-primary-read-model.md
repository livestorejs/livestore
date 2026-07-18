# 0001 — SQLite as the primary read-model realization

Status: accepted (founding decision; recorded 2026-07-16 from documented
history).

## Context

Derived state needs a queryable, reliable, fast home on the client. This
decision picks the *primary* realization of the read-model contract
(LS.SYS.STATE-R05) — it does not close the dimension: further read-model
realizations, including plain JS data structures, are planned (see the
read/write-model-separation entry in the root
[roadmap.md](../../../../roadmap.md)).

## Options

- **(a) SQLite — chosen.** Documented rationale: "many benefits … including
  performance, reliability, and ease of use"; positions local data as a
  real database rather than a cache — synchronous reads with full SQL
  (joins, aggregations) and no loading states.
- **(b) JavaScript data structures.** Not chosen as the first realization
  ("using SQLite for state management over JavaScript implementations");
  explicitly a candidate future realization behind the same contract, not
  a rejected path.

## Evidence

Documented history: `docs/understanding-livestore/design-decisions.md`;
`docs/overview/why-livestore.mdx` ("a real database, not just a cache").
Implementation evidence: this node's DSL/query-builder/system tables; the
realization-agnostic contract in `../..` (LS.SYS.STATE-R05).

## Consequences

- Bundle size grows by the SQLite WASM build (LS-T01); data must fit a
  client-side database (LS-A01).
- The vendored `wa-sqlite` build becomes delivery surface
  (`03-delivery/03-artifacts/`).
- The state contract stays realization-agnostic so future read models
  (JS structures, other stores) slot in as sibling realizations.
