# Effect Integration — Spec

This document specifies the Effect-native binding
(`packages/@livestore/livestore/src/effect/`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Surface

The binding is reachable only via the `@livestore/livestore/effect` subpath
(`package.json#exports`); the main entry re-exports no Effect API. It wraps
the same `createStore` as every other consumer — it is a Context/Layer
adapter, not a parallel store implementation (LS.SYS.INT.EFFECT-R01).

`Store.Tag(schema, storeId)` (`effect/LiveStore.ts:240-341`) returns a
yieldable `Context.Service` subclass keyed `@livestore/store/${storeId}`,
resolving to `{ stage: 'running', store }`. Statics:

| Static | Semantics |
| --- | --- |
| `.layer(props)` | Wraps `createStore` in a Layer; boot guarded by a 5-minute timeout; opens a span |
| `.Deferred` / `.DeferredLayer` / `.fromDeferred` | Async-init pattern: provide the layer now, fulfill the store later via a `Deferred` |
| `.query(q)` | Shortcut for `store.query`; error channel typed `never` |
| `.commit(...)` | Shortcut for `store.commit`; fire-and-forget — returns synchronously inside `Effect.map`, error channel typed `never` |
| `.use(fn)` | `Effect.flatMap` over the running store |

The `never`-typed error channels mirror the Store contract: `query` is
synchronous against local state and `commit` failures shut the store down
rather than surfacing per-call errors (see
[../../05-store/spec.md](../../05-store/spec.md) §Commit Path).

## Deprecated Legacy Surface

`makeLiveStoreContext`, `LiveStoreContextLayer`, and `makeStoreContext`
(`effect/LiveStore.ts:22,75,391`) predate `Store.Tag` and are marked
`@deprecated`; new code uses `Store.Tag` exclusively.
