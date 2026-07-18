# Adapter Realizations — Registry

All realizations of the adapter/runtime contract ([spec.md](./spec.md)).
Referencing mechanism per
[decision 0003](../../.decisions/0003-contrib-referencing.md).

| Realization | Home | Conformance |
| --- | --- | --- |
| Web (workers, OPFS) | [01-web/](./01-web/spec.md) | no adapter suite yet (DELTA-001, `02-conformance`) |
| Cloudflare (Durable Object) | [02-cloudflare/](./02-cloudflare/spec.md) | no adapter suite yet |
| Node | [contrib `adapter-node`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/adapter-node) · intent: contrib `context/adapters/node/` | no adapter suite yet |
| Expo | [contrib `adapter-expo`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/adapter-expo) · intent: contrib `context/adapters/expo/` | no adapter suite yet |
| Tauri / Electron | no dedicated package (embed via web/node adapters) | — |

The shared adapter conformance suite is contracted but unbuilt
(LS.SYS.VER.CONF-R03; see
[`09-verification/02-conformance/.delta/DELTA-001-adapter-conformance-missing.md`](../09-verification/02-conformance/.delta/DELTA-001-adapter-conformance-missing.md)).
