# 0002 — Reserve 4 MiB below Cloudflare's received-message ceiling

Status: accepted (official Cloudflare [WebSocket limits](https://developers.cloudflare.com/workers/runtime-apis/websockets/) and [October 2025 changelog](https://developers.cloudflare.com/changelog/post/2025-10-31-increased-websocket-message-size-limit/) retrieved 2026-08-03).

## Context

The 900,000-byte transport budget was chosen below Cloudflare's former 1 MiB
received-WebSocket-message limit. Cloudflare increased that limit to 32 MiB in
October 2025. Using the full limit would leave no room for LiveStore and Effect
RPC framing outside the measured payload.

## Options

- **28 MiB — chosen.** Leaves 4 MiB (12.5%) for framing while retaining one
  budget across WebSocket, HTTP, and DO-RPC.
- **32 MiB.** Rejected because LiveStore does not measure every outer frame.
- **900,000 bytes.** Rejected because it reflects the obsolete platform limit.

## Consequences

- Existing count- and byte-based chunking is unchanged.
