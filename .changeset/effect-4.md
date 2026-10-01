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

Breaking: upgrade the LiveStore package group to the stable Effect `4.0.0` release and replace the removed MessagePack integration with Effect's `SchemaBinary` serialization. Applications must use Effect `4.0.0` or a compatible later 4.x release. Effect moved its `effect/unstable/*` modules to `effect/*` (for example `effect/rpc`, `effect/http`, and `effect/http-api`), split `Encoding` into `effect/encoding` modules, renamed range and string checks such as `Schema.isLengthBetween` to `Schema.isBetweenLength`, and now returns `[passes, fails]` from `Array.partition`. The renamed checks do not change state schema fingerprints. Event definitions get new schema hashes, so the first rematerialization after upgrading can log schema hash mismatch warnings. `@livestore/utils/effect` no longer re-exports `Encoding`; use the re-exported `Base64Url` module instead. The FastCheck-based `Vitest.asProp` helper is removed; use `Vitest.live.prop` with `arbitrary` options.
