// TODO we should figure out a way to avoid needing this entire file/module to begin with (cc Sunil Pai)
// Re-exports Cloudflare Workers runtime globals with proper CF types for use in non-CF-typed contexts

const _ReadableStream = ReadableStream
const _Request = Request
const _Response = Response
const _Rpc = Rpc
const _WebSocket = WebSocket
const _WebSocketPair = WebSocketPair
const _WebSocketRequestResponsePair = WebSocketRequestResponsePair

export {
  _ReadableStream as ReadableStream,
  _Request as Request,
  _Response as Response,
  _Rpc as Rpc,
  _WebSocket as WebSocket,
  _WebSocketPair as WebSocketPair,
  _WebSocketRequestResponsePair as WebSocketRequestResponsePair,
}
