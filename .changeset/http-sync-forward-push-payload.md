---
"@livestore/sync-cf": patch
---

**Cloudflare HTTP sync:** Forward the client `payload` to the Durable Object `onPush` callback over the HTTP transport. The HTTP push handler previously passed `undefined`, so auth/validation payloads never reached `onPush` over HTTP even though the WebSocket and DO-RPC transports already forwarded it (#1417). No config or migration is needed, but an `onPush` that validates the payload may now reject HTTP pushes it previously let through while the payload arrived as `undefined`.
