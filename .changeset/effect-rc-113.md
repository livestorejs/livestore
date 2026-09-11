---
'@livestore/adapter-cloudflare': minor
'@livestore/adapter-web': minor
'@livestore/common': minor
'@livestore/common-cf': minor
'@livestore/framework-toolkit': minor
'@livestore/livestore': minor
'@livestore/peer-deps': minor
'@livestore/react': minor
'@livestore/sqlite-wasm': minor
'@livestore/sync-cf': minor
'@livestore/utils': minor
'@livestore/utils-dev': minor
'@livestore/webmesh': minor
---

Breaking: upgrade the LiveStore package group to Effect `4.0.0-rc.113` and replace the removed MessagePack integration with Effect's `SchemaBinary` serialization. The FastCheck-based `Vitest.asProp` helper is removed; use `Vitest.live.prop` with `arbitrary` options.
