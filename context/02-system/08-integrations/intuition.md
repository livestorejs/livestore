# Framework Integrations — Intuition

*For: contributors building or maintaining framework bindings · Assumes:
[../05-store/intuition.md](../05-store/intuition.md) · Covers: why
integrations are thin and where the shared logic lives*

## Translators, not engines

An integration owns no data and adds no semantics — the store already is the
state manager. What a framework binding does is purely idiomatic
translation: expose a live query as the framework's native reactive value,
tie store lifetime to component lifetime, and route subscriber effects
through the framework's batching. If logic feels reusable across frameworks,
it doesn't belong in a binding.

```
store (framework-agnostic)      framework
  live query  ───────────────▶  native reactive value (e.g. hook)
  registry acquire/release ──▶  mount/unmount lifecycle
  batchUpdates hook ─────────▶  framework's render batching
```

## The toolkit is the anti-drift device

Everything genuinely cross-framework lives once in `framework-toolkit`:
normalizing the query-shaped inputs (query builder, live query defs) into
one internal shape, client-document get/set helpers, stack-info provenance
for devtools. React, Vue, Solid, and Svelte bindings compose the same
primitives — so behavior differences between frameworks are, by
construction, binding bugs rather than semantic forks.

## The hard part is the framework's own semantics

The engine guarantees glitch-free synchronous updates
([../05-store/](../05-store/spec.md)); the binding must not undo that under
its framework's rendering model — StrictMode double-invocation, concurrent
rendering, disposal ordering. Robustness under those semantics, and reactive
parity (no stale reads, no missed updates), are the contract obligations a
binding is verified against; a shared conformance suite is still an open
question ([spec.md](./spec.md), with `../09-verification/`).

React ([01-react/](./01-react/spec.md)) is the in-repo reference binding;
Effect ([02-effect/](./02-effect/spec.md)) shows that "framework" doesn't
mean UI — it binds the store to Layer/Context idioms the same way React
binds it to hooks. Vue/Solid/Svelte live in contrib.
