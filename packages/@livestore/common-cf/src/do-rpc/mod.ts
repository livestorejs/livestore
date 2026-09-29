// Re-export client and server implementations for backward compatibility
export { layerProtocolDurableObject } from './client.ts'
export { emitStreamResponse, type SyncUpdateAck, type SyncUpdateCallback, toDurableObjectHandler } from './server.ts'
