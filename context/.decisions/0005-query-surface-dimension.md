# 0005 — Query surfaces as a realization dimension (graphql re-home)

Status: accepted (2026-07-17, design interview with schickling)

## Context

Contrib's `@livestore/graphql` was filed under the framework-integration
dimension (`08-integrations/`, `LS.SYS.INT-*`) because that was the nearest
existing home. But GraphQL is not a UI-framework binding: it adds a new
**live-query kind** to the reactive graph — a different query language over the
same session state — and refines the reactivity contract
(`05-store/01-reactivity/`, `LS.SYS.STORE.RX-*`), not the integration contract.
The mismatch was tracked as a contrib delta and an open question (LSC-DQ1).

## Options

- **A. Keep it under `integrations/`**, documented as a "query-surface
  integration." Least churn, but the folder and the `refines:` anchor disagree,
  and the ontology stays wrong.
- **B. Introduce a first-class query-surface dimension (chosen).** Query kinds
  are already a composable, pluggable part of the reactive graph
  (LS.SYS.STORE.RX-R02); make that extensibility explicit as a realization
  dimension with its own registry, and home query surfaces there.

## Decision

Option B. Core `05-store/01-reactivity/` gains a `realizations.md` registry and
a spec §"Extension: query surfaces" establishing that the built-in query kinds
are not a closed set. Contrib's graphql node moves to `context/query-surfaces/`
under the `LSC.QS.*` namespace, refining `LS.SYS.STORE.RX-*`; it leaves the
`08-integrations/` registry. Evidence: user decision in the 2026-07-17 interview
(chose "add core query-surface category + re-home" over keeping it in place).

## Consequences

- New realization dimension alongside adapters, sync providers, framework
  integrations, and devtools surfaces: **query surfaces** (contract in
  `05-store/01-reactivity/`).
- Contrib graphql node re-homed and renumbered (`LSC.INT.GQL-*` →
  `LSC.QS.GQL-*`); its placement delta is resolved and removed; LSC-DQ1 closes.
- Future query languages over the store (a second GraphQL-like surface, a
  different DSL) get a defined home rather than being parked under integrations.
