---
---

No release impact. Adds a regression test that the Cloudflare sync backend Durable Object still hibernates when its only client is an idle live pull over Durable Object RPC (not a WebSocket) (#1328): reintroducing a timer that pins the DO resident turns the test red. Stacked on #1427, reusing its non-persisted `instanceId` probe; runs in the `cf-do-rpc-do` matrix cell but does not gate a merge (those cells swallow failures, #1430). Guards non-hibernation only — it deliberately does not assert that the live pull survives hibernation, which over DO RPC is a separate, currently-failing property (the rebuilt DO drops its in-memory subscribers).
