# Sync Provider Realizations — Registry

All realizations of the sync-provider contract ([spec.md](./spec.md)).
Referencing mechanism per
[decision 0003](../../.decisions/0003-contrib-referencing.md): in-repo
realizations are child nodes; contrib realizations host their own intent
nodes in `livestore-contrib` and reference core contract IDs.

| Realization | Home | Conformance |
| --- | --- | --- |
| Cloudflare (WS / HTTP / DO-RPC) | [03-cf/](./03-cf/spec.md) | in the 7-provider suite (`tests/sync-provider/`) |
| Mock (in-memory, tests) | `common/src/sync/mock-sync-backend.ts` | in the suite |
| ElectricSQL | [contrib `sync-electric`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/sync-electric) · intent: contrib `context/sync/electric/` | not in the conformance matrix |
| S2 | [contrib `sync-s2`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/sync-s2) · intent: contrib `context/sync/s2/` | not in the conformance matrix |

Contrib providers are not exercised by the conformance matrix today; suite
scope and assertion gaps are tracked in
[`09-verification/02-conformance/`](../09-verification/02-conformance/spec.md).
