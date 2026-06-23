// Re-export client and server implementations for backward compatibility
export { layerProtocolDurableObject } from './client.ts'
export {
  type ClientDoWithRpcCallback,
  emitStreamResponse,
  type SyncUpdateRpcResult,
  toDurableObjectHandler,
} from './server.ts'
