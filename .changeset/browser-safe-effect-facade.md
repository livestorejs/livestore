---
'@livestore/utils': minor
---

Fix browser bundling of `@livestore/utils/effect` by keeping Effect's Node-only schema test assertions out of the runtime facade.

`TestSchema` is no longer exported from `@livestore/utils/effect`; tests should import it from `effect/testing`.
