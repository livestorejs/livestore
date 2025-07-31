# Effect RPC Implementation for Cloudflare Durable Objects RPC

## Overview

This module provides a direct RPC communication layer for Cloudflare Durable Objects using Effect RPC. Instead of communicating over HTTP/WebSocket like traditional RPC implementations, this uses Cloudflare's native Durable Object RPC calls for efficient, low-latency communication between Durable Objects.

## Design Goals

### Primary Objectives

1. **Direct DO-to-DO Communication**: Enable RPC calls directly between Durable Objects without HTTP overhead
2. **Effect RPC Compatibility**: Maintain full compatibility with Effect's RPC system and patterns (incl. type-safety and schema support)
3. **Streaming**: Support real-time streaming responses using `ReadableStream` at the transport level

### Architecture Principles

- **Minimal Transport**: Use msgpack serialization over Cloudflare's native DO RPC
- **Streaming-First**: Design for progressive data delivery rather than batch responses
- **Effect-Native**: Leverage Effect's streaming, error handling, and context management
- **Simple API**: Maintain the same API surface as standard Effect RPC clients/servers

## Current Implementation

### Components

- **`client.ts`**: RPC client protocol using `layerProtocolDurableObject`
- **`server.ts`**: RPC server handler using `toDurableObjectHandler`

### Transport Layer

- **Serialization**: msgpack for efficient binary encoding
- **Streaming**: `ReadableStream` support for multi-value responses (requires binary messages)

## Usage Example

```typescript
const MyRpcs = RpcGroup.make(
  Rpc.make('Add', {
    payload: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
    success: Schema.Struct({ result: Schema.Number }),
  }),
  Rpc.make('Divide', {
    payload: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
    success: Schema.Struct({ result: Schema.Number }),
    error: Schema.String,
  }),
  Rpc.make('CountUp', {
    payload: Schema.Struct({ startValue: Schema.Number }),
    success: Schema.Struct({ result: Schema.Number }),
    stream: true,
  }),
)

// Server setup
const MyRpcsLive = MyRpcs.toLayer({
  Add: ({ a, b }) => Effect.succeed({ result: a + b }),
  Divide: ({ a, b }) => Effect.succeed({ result: a / b }),
  CountUp: ({ startValue }) => Stream.iterate(startValue, (acc) => acc + 1).pipe(Stream.schedule(Schedule.spaced(1000))),
})


const handler = toDurableObjectHandler(MyRpcs, {
  layer: MyRpcsLive
})

// In Durable Object
async rpc(payload: Uint8Array): Promise<Uint8Array | ReadableStream> {
  return handler(payload)
}

// Client setup  
const client = RpcClient.make(MyRpcs, {
  layer: layerProtocolDurableObject(
    (payload) => serverDO.rpc(payload)
  )
})

// Usage (client side)
const result = yield* client.Add({ a: 1, b: 2 })
const result2 = yield* client.Divide({ a: 1, b: 2 })
const result3 = yield* client.CountUp({ startValue: 0 }).pipe(Stream.take(10), Stream.runCollect)
```

## Effect RPC reference

