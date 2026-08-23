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

Breaking: move the LiveStore package group to Effect `4.0.0-rc.111`.

Applications must bump their Effect peers to the matching release. Effect's `Schema.isDateValid` was removed because `Schema.DateFromString` and `Schema.DateFromMillis` now reject invalid dates on their own, so `Schema.DateFromString.check(Schema.isDateValid())` becomes plain `Schema.DateFromString`.
