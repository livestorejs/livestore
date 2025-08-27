export {
  ReadableStream,
  Request,
  Response,
  Rpc,
  WebSocket,
  WebSocketPair,
  WebSocketRequestResponsePair,
} from '@cloudflare/workers-types'

// import type * as CF from '@cloudflare/workers-types'

// export const ReadableStream = globalThis.ReadableStream as unknown as typeof CF.ReadableStream
// export const Request = globalThis.Request
// export const Response = globalThis.Response
// export const WebSocket = globalThis.WebSocket as unknown as typeof CF.WebSocket
// export const Rpc = globalThis.Rpc as unknown as typeof CF.Rpc
// // @ts-expect-error WebSocketPair is not defined in the globalThis object
// export const WebSocketPair = globalThis.WebSocketPair as unknown as typeof CF.WebSocketPair
// export const WebSocketRequestResponsePair =
//   // @ts-expect-error WebSocketRequestResponsePair is not defined in the globalThis object
//   globalThis.WebSocketRequestResponsePair as unknown as typeof CF.WebSocketRequestResponsePair
