---
---

No release impact. Adds a regression test that the Cloudflare sync backend Durable Object still hibernates once its WebSocket clients go idle (#1328): reintroducing a timer that pins the DO resident — billing full wall-clock residency at zero traffic — turns the test red. It runs in the sync-provider matrix but does not yet gate a merge, since those cells currently swallow failures (#1430).

Both ends are real: the test drives the production `makeWsSync` client against the real `SyncBackendDO` through the real sync router, and covers both a plain idle connection and one holding an open live pull. Hibernation is observed through a per-construction instance id the Durable Object never persists. Two guards keep a green run meaningful — the probe requires a WebSocket to still be attached before and after the idle window (otherwise "the idle DO evicted" is trivially true), and a deliberately warmed Durable Object must report an unchanged instance id.
