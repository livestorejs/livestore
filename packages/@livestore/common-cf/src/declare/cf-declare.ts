/// <reference types="@cloudflare/workers-types" />

// TODO we should figure out a way to avoid needing this entire file/module to begin with (cc Sunil Pai)
// Re-exports Cloudflare Workers runtime globals with proper CF types for use in non-CF-typed contexts.
// Uses ambient declarations since globalThis isn't typed with CF globals without DOM lib.

import type * as CF from '@cloudflare/workers-types'

// Declare that these CF runtime globals exist (they're provided by @cloudflare/workers-types as ambient)
declare const ReadableStream: typeof CF.ReadableStream
declare const Request: typeof CF.Request
declare const Response: typeof CF.Response
declare const WebSocket: typeof CF.WebSocket
declare const Rpc: typeof CF.Rpc
declare const WebSocketPair: typeof CF.WebSocketPair
declare const WebSocketRequestResponsePair: typeof CF.WebSocketRequestResponsePair

export { ReadableStream, Request, Response, Rpc, WebSocket, WebSocketPair, WebSocketRequestResponsePair }
