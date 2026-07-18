# Reactivity — Requirements

The reactive layer of the Store: the incremental graph, the live-query
kinds, and the dedup/caching layers that keep synchronous reads cheap.
Refines the reactivity and synchronous-read requirements of the root via
the Store contract ([../requirements.md](../requirements.md)).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS.STORE-*`). State
materialization semantics: `../../02-state/`; framework consumption:
`../../08-integrations/`.

R01 and R02 below were re-homed from the parent node on 2026-07-16
(formerly `LS.SYS.STORE-R03` and `LS.SYS.STORE-R05`).

## Requirements

- **LS.SYS.STORE.RX-R01 Reactive subscriptions:** Subscriptions fire exactly
  when a query's result may have changed, driven by an incremental
  reactivity graph rather than re-running all queries. `refines: LS-R12`
- **LS.SYS.STORE.RX-R02 Composable query kinds:** Db queries, computed
  values, and signals compose into one reactive graph; client-document
  queries build on the same primitives.
- **LS.SYS.STORE.RX-R03 Two-level dedup:** Identical query definitions share
  one live instance (keyed by definition hash); identical SQL + bind values
  share a bounded result cache invalidated per written table (see
  [spec.md](./spec.md)). Adopted 2026-07-16 (interview). `refines: LS-R14`
- **LS.SYS.STORE.RX-R04 Explicit deps:** A contextual db query whose builder
  function cannot be introspected (Hermes/Expo) must supply explicit `deps`;
  construction fails fast otherwise. Adopted 2026-07-16 (interview).
- **LS.SYS.STORE.RX-R05 Equality cutoff:** A query does not re-emit when its
  decoded result is schema-equivalent to the previous one; supplying `map`
  disables the cutoff. Adopted 2026-07-16 (interview). `refines: LS-R12`
