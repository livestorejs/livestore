# 0003 — Contrib realizations: core registries, contrib-hosted intent nodes

Status: accepted (2026-07-16, design interview with schickling; resolves
LS-DQ2)

## Context

The product is delivered from two repos under one identity (LS-A04;
decision 0001). Every pluggable dimension in `02-system/` has contrib-owned
realizations (`adapter-node`, `adapter-expo`, `sync-electric`, `sync-s2`,
`solid`, `svelte`, `devtools-expo`, `graphql`), and until now each dimension
spec said "stub pending LS-DQ2" with no defined referencing mechanism.

## Options

- **A. Per-realization stub children in the core tree.** Pattern-conformant
  (every realization a child node), but produces ~9 near-empty core nodes
  whose real content lives in another repo, and forces cross-repo ID
  allocation in the core namespace table.
- **B. Registry file per dimension in core + contrib hosts its own intent
  nodes (chosen).** Each dimension node carries a `realizations.md`
  companion listing all realizations (in-repo and contrib) with homes and
  conformance status. `livestore-contrib` hosts its own intent layer whose
  realization nodes reference core contract IDs (`LS.*`) by citation and
  link; contrib IDs use the contrib tree's own `LSC.*` namespaces and never
  enter the core ID table.
- **C. One cross-repo tree.** A single tree spanning both repos — rejected:
  couples doc changes across repos and contradicts the mechanical ownership
  boundary (decision `03-delivery/.decisions/0001`).

## Decision

Option B. Evidence: user decision in the 2026-07-16 interview (Q29b),
including the instruction to start the contrib intent layer immediately
(starter PR on `livestore-contrib`).

## Consequences

- The four dimension registries exist
  (`02-system/{03-sync,04-runtime,07-devtools,08-integrations}/realizations.md`);
  dimension specs link them instead of "stub pending LS-DQ2".
- `livestore-contrib` gains a starter `context/` (intuition + conventions +
  seed realization nodes) that cites core contracts; its tree evolves under
  contrib's own queue.
- The `cli` package realizes no `02-system/` dimension; it stays outside
  the registries (delivery/product concern).
- LS-DQ2 leaves `open-questions.md`.
