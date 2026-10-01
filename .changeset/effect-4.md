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

Breaking: require the stable Effect `4.0.0` release. The Effect peer range is `^4.0.0`, which no longer accepts `4.0.0-rc.*` prereleases; see the Effect changelog for Effect's own breaking changes. `@livestore/utils/effect` no longer re-exports `Encoding`; use the re-exported `Base64Url` module instead. The removed MessagePack integration is replaced with Effect's `SchemaBinary` serialization. The FastCheck-based `Vitest.asProp` helper is removed; use `Vitest.live.prop` with `arbitrary` options. The upgrade does not change state schema fingerprints. Event definitions get new schema hashes, so the first rematerialization after upgrading can log schema hash mismatch warnings.
