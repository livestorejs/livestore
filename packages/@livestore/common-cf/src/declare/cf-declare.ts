/// <reference types="@cloudflare/workers-types" />

// TODO we should figure out a way to avoid needing this entire file/module to begin with (cc Sunil Pai)

import type * as CF from '@cloudflare/workers-types'

// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
export const ReadableStream = globalThis.ReadableStream as unknown as typeof CF.ReadableStream
// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
export const Request = globalThis.Request as unknown as typeof CF.Request
// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
export const Response = globalThis.Response as unknown as typeof CF.Response
// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
export const WebSocket = globalThis.WebSocket as unknown as typeof CF.WebSocket
// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
export const Rpc = globalThis.Rpc as unknown as typeof CF.Rpc
// @ts-expect-error WebSocketPair is not defined in the globalThis object
// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
export const WebSocketPair = globalThis.WebSocketPair as unknown as typeof CF.WebSocketPair
export const WebSocketRequestResponsePair =
  // @ts-expect-error WebSocketRequestResponsePair is not defined in the globalThis object
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API types to Cloudflare Worker types; inherent platform type mismatch
  globalThis.WebSocketRequestResponsePair as unknown as typeof CF.WebSocketRequestResponsePair
