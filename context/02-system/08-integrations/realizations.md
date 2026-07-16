# Framework Integration Realizations — Registry

All realizations of the framework-integration contract
([spec.md](./spec.md)). Referencing mechanism per
[decision 0003](../../.decisions/0003-contrib-referencing.md).

| Realization | Home | Conformance |
| --- | --- | --- |
| React | [01-react/](./01-react/spec.md) | no binding suite yet (DELTA-002, `02-conformance`) |
| Effect (Layer/Context idioms) | [02-effect/](./02-effect/spec.md) | no binding suite yet |
| Solid | [contrib `solid`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/solid) · intent: contrib `context/integrations/solid/` | no binding suite yet |
| Svelte | [contrib `svelte`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/svelte) · intent: contrib `context/integrations/svelte/` | no binding suite yet |
| GraphQL (query-surface integration) | [contrib `graphql`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/graphql) | — |
| Vue | no package today | — |

The realization-independent binding conformance suite is contracted but
unbuilt (LS.SYS.VER.CONF-R04; see
[`09-verification/02-conformance/.delta/DELTA-002-framework-conformance-missing.md`](../09-verification/02-conformance/.delta/DELTA-002-framework-conformance-missing.md)).
