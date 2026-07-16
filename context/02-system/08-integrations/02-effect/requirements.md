# Effect Integration — Requirements

The Effect realization of the integration contract: the Store consumed
through Effect's Context/Layer idioms rather than a UI framework's
rendering model. A peer of [../01-react/](../01-react/requirements.md).
Refines [../requirements.md](../requirements.md) (`LS.SYS.INT-*`).

## Context

Builds on the integration contract (`LS.SYS.INT-R01`…`R05`; rendering-model
clauses apply vacuously — Effect has no render semantics, but resource
lifecycle and thin-wrapper constraints apply in full). Surface lives in
`packages/@livestore/livestore/src/effect/` and ships via the
`@livestore/livestore/effect` subpath.

## Requirements

- **LS.SYS.INT.EFFECT-R01 Effect realization:** The store is consumable as a
  first-class Effect Context/Layer service (`Store.Tag`) via the
  `@livestore/livestore/effect` subpath, wrapping the same `createStore` as
  every other consumer — no parallel store implementation (see
  [spec.md](./spec.md)). Adopted 2026-07-16 (interview).
  `refines: LS.SYS.INT-R01`
