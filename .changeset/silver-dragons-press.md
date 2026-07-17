---
---

No release impact. Adds a regression test that the Cloudflare sync backend Durable Object still hibernates once its WebSocket clients go idle (#1328), so it cannot silently regress to billing for full wall-clock residency at zero traffic.

Both ends are real: the test drives the production `makeWsSync` client against the real `SyncBackendDO` through the real sync router, and covers both a plain idle connection and one holding an open live pull. Hibernation is observed through a per-construction instance id the Durable Object never persists. Two guards keep a green run meaningful — the probe requires a WebSocket to still be attached before and after the idle window (otherwise "the idle DO evicted" is trivially true), and a deliberately warmed Durable Object must report an unchanged instance id.
