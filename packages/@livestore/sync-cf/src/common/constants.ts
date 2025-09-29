// Shared transport limits for Cloudflare sync provider
// Keep payloads comfortably below ~1MB WS frame cap for hibernated DO WebSockets.
// References:
// - Durable Objects WebSockets + hibernation best practices:
//   https://developers.cloudflare.com/durable-objects/best-practices/websockets/
// - Workers platform limits (general context):
//   https://developers.cloudflare.com/workers/platform/limits/
// Empirically, frames just below 1MB can fail on hibernated DO WebSockets; we use 900_000 bytes to keep a safety margin.
export const MAX_WS_MESSAGE_BYTES = 900_000

// Upper bound for items per WS message. Mirrors server’s broadcast chunking.
// Not a Cloudflare-enforced limit; chosen to balance payload size and latency.
export const MAX_PULL_EVENTS_PER_MESSAGE = 100
