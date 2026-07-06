---
'@livestore/utils': minor
---

Breaking: remove the LiveStore-local `Scheduler.messageChannel()` helper from `@livestore/utils/effect`.

LiveStore does not use the helper internally under Effect v4. Scheduler consumers should rely on Effect's default `MixedScheduler` unless they have a runtime-specific scheduler override.
