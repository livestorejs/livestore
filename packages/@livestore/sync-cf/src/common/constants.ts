// Keep payloads 4 MiB below Cloudflare's 32 MiB received-message limit for framing headroom.
// References:
// - https://developers.cloudflare.com/workers/runtime-apis/websockets/
// - https://developers.cloudflare.com/changelog/post/2025-10-31-increased-websocket-message-size-limit/
export const MAX_TRANSPORT_PAYLOAD_BYTES = 28 * 1024 * 1024

export const MAX_WS_MESSAGE_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES
export const MAX_DO_RPC_REQUEST_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES
export const MAX_HTTP_REQUEST_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES

// Upper bound for items per message/request. Mirrors server broadcast chunking.
// Not Cloudflare-enforced; chosen to balance payload size and latency.
export const MAX_PULL_EVENTS_PER_MESSAGE = 100
export const MAX_PUSH_EVENTS_PER_REQUEST = 100
