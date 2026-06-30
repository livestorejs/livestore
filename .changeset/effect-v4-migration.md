---
"@livestore/adapter-cloudflare": minor
"@livestore/adapter-web": minor
"@livestore/common": minor
"@livestore/common-cf": minor
"@livestore/framework-toolkit": minor
"@livestore/livestore": minor
"@livestore/peer-deps": minor
"@livestore/react": minor
"@livestore/sqlite-wasm": minor
"@livestore/sync-cf": minor
"@livestore/utils": minor
"@livestore/utils-dev": minor
"@livestore/wa-sqlite": minor
"@livestore/webmesh": minor
---

Breaking: migrate the LiveStore package group to Effect v4.

LiveStore now targets `effect@^4.0.0-beta.83` and the matching Effect v4 package family. Applications must install compatible Effect v4 peers and remove obsolete Effect v3 peer packages such as `@effect/ai`, `@effect/cli`, `@effect/cluster`, `@effect/experimental`, `@effect/platform`, `@effect/printer`, `@effect/printer-ansi`, `@effect/rpc`, `@effect/sql`, and `@effect/typeclass` when they were only present for LiveStore.

The `@livestore/utils/effect` facade now follows Effect v4's consolidated package layout. Imports that depended on v3-era facade exports need to move to the corresponding Effect v4 modules. The facade no longer exports the LiveStore-local `BucketQueue` and `ServiceContext` helpers.
