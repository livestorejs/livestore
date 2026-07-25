---
---

No release impact. Repin effect-utils to `47ee69b7` (from `f007561`) to adopt the operation-aware git-subprocess timeout in `@overeng/megarepo` — network git ops (clone/fetch/…) get a 10min budget instead of the flat 30s, fixing intermittent `git clone … timed out after 30000ms` failures in the "Sync megarepo dependencies" CI step (#1473, overengineeringstudio/effect-utils#965). Bumps all three effect-utils authority edges (megarepo.lock + the two devenv.lock inputs) together and regenerates the 5 genie CI workflows, which also adopt effect-utils' per-workspace pnpm-store CI layout (cache key `v1` → `v1-v2`).
