/// <reference types="@cloudflare/workers-types" />

// TODO we should figure out a way to avoid needing this entire file/module to begin with (cc Sunil Pai)

import type * as CF from '@cloudflare/workers-types'

// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
const cfGlobalThis = globalThis as typeof globalThis & {
  ReadableStream: typeof CF.ReadableStream
  Request: typeof CF.Request
  Response: typeof CF.Response
  WebSocket: typeof CF.WebSocket
  Rpc: typeof CF.Rpc
  WebSocketPair: typeof CF.WebSocketPair
  WebSocketRequestResponsePair: typeof CF.WebSocketRequestResponsePair
}

export const ReadableStream = cfGlobalThis.ReadableStream
export const Request = cfGlobalThis.Request
export const Response = cfGlobalThis.Response
export const WebSocket = cfGlobalThis.WebSocket
export const Rpc = cfGlobalThis.Rpc
export const WebSocketPair = cfGlobalThis.WebSocketPair
export const WebSocketRequestResponsePair = cfGlobalThis.WebSocketRequestResponsePair
