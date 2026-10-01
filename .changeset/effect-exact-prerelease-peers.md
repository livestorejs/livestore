---
'@livestore/adapter-cloudflare': minor
'@livestore/adapter-web': minor
'@livestore/common': minor
'@livestore/common-cf': minor
'@livestore/framework-toolkit': minor
'@livestore/livestore': minor
'@livestore/react': minor
'@livestore/sqlite-wasm': minor
'@livestore/sync-cf': minor
'@livestore/utils': minor
'@livestore/utils-dev': minor
'@livestore/webmesh': minor
---

Breaking: Effect prerelease peer dependencies now require exactly `4.0.0-rc.113`. Caret ranges on prereleases did not enforce the intended compatibility, so applications using another Effect prerelease must align to rc.113.
