---
'@livestore/livestore': minor
---

Fix the `store.commit` callback form and its TypeScript overloads, including calls with commit options. A synchronous callback now returns an array describing the complete event batch, which LiveStore collects before materialization so throwing callbacks apply no events. Fixes [#1611](https://github.com/livestorejs/livestore/issues/1611) and follows up on [#1616](https://github.com/livestorejs/livestore/pull/1616).

Replace `store.commit((commit) => { commit(event) })` with `store.commit(() => [event])` or `store.commit(event)`. Callback builders must be synchronous and return an array, including `[]` for an empty batch.
