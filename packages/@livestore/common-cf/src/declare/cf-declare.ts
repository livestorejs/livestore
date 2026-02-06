/// <reference types="@cloudflare/workers-types" />

// TODO we should figure out a way to avoid needing this entire file/module to begin with (cc Sunil Pai)

import type * as CF from '@cloudflare/workers-types'

export const ReadableStream = globalThis.ReadableStream as unknown as typeof CF.ReadableStream
export const Request = globalThis.Request as unknown as typeof CF.Request
export const Response = globalThis.Response as unknown as typeof CF.Response
export const WebSocket = globalThis.WebSocket as unknown as typeof CF.WebSocket
export const Rpc = globalThis.Rpc as unknown as typeof CF.Rpc
// @ts-expect-error WebSocketPair is not defined in the globalThis object
export const WebSocketPair = globalThis.WebSocketPair as unknown as typeof CF.WebSocketPair
export const WebSocketRequestResponsePair =
  // @ts-expect-error WebSocketRequestResponsePair is not defined in the globalThis object
  globalThis.WebSocketRequestResponsePair as unknown as typeof CF.WebSocketRequestResponsePair
