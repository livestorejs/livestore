---
---

No release impact. Docs-site build fix: vendor the six example-gallery screenshots as local Astro assets (`docs/src/assets/examples/`) instead of fetching them from `gitbucket.schickling.dev` at build time via `image.domains`. Astro's remote-image optimization had zero retry tolerance, so a single transient fetch blip hard-aborted the entire production docs deploy (leaving `docs.livestore.dev/misc/sponsoring` stuck at 502). The build is now hermetic — images are optimized locally via `sharp` with no network fetch. Adds a reproducible `devenv tasks run docs:screenshots` Playwright capture task for the three in-repo web apps (TodoMVC, LinearLite, TodoMVC + CF Sync); the three contrib-repo apps are refreshed manually until that repo grows its own capture task.
