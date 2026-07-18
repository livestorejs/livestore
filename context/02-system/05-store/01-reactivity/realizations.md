# Query-Surface Realizations — Registry

Query kinds are a composable, pluggable dimension of the reactive graph
(LS.SYS.STORE.RX-R02). A **query surface** adds a live-query kind that resolves
against session state and participates in reactivity, dedup, and the equality
cutoff like the built-in kinds — so a new query language can be layered on the
store without touching the engine. Referencing mechanism per
[decision 0003](../../../.decisions/0003-contrib-referencing.md).

| Realization | Home | Conformance |
| --- | --- | --- |
| Built-in kinds (db query, computed, signal, client-document) | [spec.md](./spec.md) | covered by store/reactivity unit tests |
| GraphQL | [contrib `graphql`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/graphql) · intent: contrib `context/query-surfaces/graphql/` | no query-surface suite yet |

There is no shared query-surface conformance suite today; a contrib query
surface's parity with the built-in kinds (reactivity, dedup, cutoff) is
verified by its own package tests, where present.
