// Shared transport limits for Cloudflare sync provider
// Keep payloads comfortably below ~1MB frame caps across Cloudflare transports.
// References:
// - Durable Objects WebSockets + hibernation best practices:
//   https://developers.cloudflare.com/durable-objects/best-practices/websockets/
// - Workers platform limits (general context):
//   https://developers.cloudflare.com/workers/platform/limits/
// Empirically, frames just below 1MB can fail on hibernated DO WebSockets; we use 900_000 bytes to keep a safety margin.
export const MAX_TRANSPORT_PAYLOAD_BYTES = 900_000

export const MAX_WS_MESSAGE_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES
export const MAX_DO_RPC_REQUEST_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES
export const MAX_HTTP_REQUEST_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES

// Upper bound for items per message/request. Mirrors server broadcast chunking.
// Not Cloudflare-enforced; chosen to balance payload size and latency.
export const MAX_PULL_EVENTS_PER_MESSAGE = 100
export const MAX_PUSH_EVENTS_PER_REQUEST = 100
