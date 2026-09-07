---
'@livestore/livestore': minor
---

Fix the documented `store.commit` callback form and its TypeScript overloads, including calls with commit options. Collect emitted events before materialization so throwing callbacks apply no events. Fixes [#1611](https://github.com/livestorejs/livestore/issues/1611).

Callback return values are now ignored. Replace the undocumented `store.commit(() => [event])` form with `store.commit(event)` or emit events through the supplied callback.
