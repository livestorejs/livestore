---
---

No release impact. Adds a regression test that the Cloudflare sync Durable Object still hibernates when idle (#1328), so it cannot silently regress to billing for full wall-clock residency at zero traffic. The test runs the real WS-RPC server in workerd and observes the actual hibernation outcome via a per-construction instance id, alongside a sentinel Durable Object that re-introduces the disqualifying `setInterval` and must stay resident — without that counter-case a green run would prove nothing.
