# Devtools Surface Realizations — Registry

All realizations of the devtools surface contract (the enumeration itself
is contractual, LS.SYS.DT-R12 — see [spec.md](./spec.md) §Surfaces).
Referencing mechanism per
[decision 0003](../../.decisions/0003-contrib-referencing.md).

| Realization | Home | Conformance |
| --- | --- | --- |
| Web channel | `adapter-web` `./devtools-web-channel` | devtools protocol compat test (3 cases) |
| Browser extension | `adapter-web` client-session bridge | same handshake path |
| Devtools UI | separate artifact pipeline ([`03-delivery/03-artifacts/`](../../03-delivery/03-artifacts/spec.md)) | version-pinned to `liveStoreVersion` |
| Expo devtools | [contrib `devtools-expo`](https://github.com/livestorejs/livestore-contrib/tree/main/packages/%40livestore/devtools-expo) · intent: contrib `context/devtools/expo/` | not covered by the compat test |
