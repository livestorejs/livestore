# @livestore/webmesh

Webmesh is a library for connecting multiple nodes (windows/tabs, workers, threads, ...) in a network-like topology. It helps to establish communication channels between nodes.

There are three types of channels:
- ProxyChannel: a virtual channel by proxying messages along edges (via hop nodes)
- DirectChannel: an end-to-end channel with support for transferable objects (e.g. `Uint8Array`) 
- BroadcastChannel: a virtual channel by broadcasting messages to all connected nodes

ProxyChannels and DirectChannels have the following properties (similar to TCP):
- Has a unique name across the network
- Auto-reconnects
- Ordered messages
- Reliable (buffers messages and acks each message)

## Available edge connection implementations

- `MessageChannel`
- `BroadcastChannel` (both web and Node.js)
- `WebSocket`
- `window.postMessage`

## Example

Scenario: For topology `A <> B <> C`, we want to create direct channel between `A` and `C`

```ts
import { makeMeshNode, Packet, WebChannel } from '@livestore/webmesh'

const ChannelSchema = Schema.Struct({ message: Schema.String })

// Creating shared message channels between nodes to simplify the example.
// In a real-world application, you would use e.g. a shared worker or similar to exchange the message channels between nodes.
const mcA_B = new MessageChannel()
const mcB_C = new MessageChannel()

// e.g. running in tab A of a browser
const codeOnNodeA = Effect.gen(function* () {
  const nodeA = yield* makeMeshNode('A')

  // create edge to node B using a MessageChannel
  const edgeChannelB = yield* WebChannel.messagePortChannel({ port: mcA_B.port1, schema: Packet })
  yield* nodeA.addEdge({ target: 'B', edgeChannel: edgeChannelB })

  const channelToC = yield* nodeA.makeChannel({ target: 'C', schema: ChannelSchema })

  yield* channelToC.send('Hello from A')
})

// e.g. running in tab B of a browser
const codeOnNodeB = Effect.gen(function* () {
  const nodeB = yield* makeMeshNode('B')

  const edgeChannelA = yield* WebChannel.messagePortChannel({ port: mcA_B.port2, schema: Packet })
  yield* nodeB.addEdge({ target: 'A', edgeChannel: edgeChannelA })

  const edgeChannelC = yield* WebChannel.messagePortChannel({ port: mcB_C.port2, schema: Packet })
  yield* nodeB.addEdge({ target: 'C', edgeChannel: edgeChannelC })
})

// e.g. running in tab C of a browser
const codeOnNodeC = Effect.gen(function* () {
  const nodeC = yield* makeMeshNode('C')

  const edgeChannelB = yield* WebChannel.messagePortChannel({ port: mcB_C.port1, schema: Packet })
  yield* nodeC.addEdge({ target: 'B', edgeChannel: edgeChannelB })

  const channelToA = yield* nodeC.makeChannel({ target: 'A', schema: ChannelSchema })

  const message = yield* channelToA.listen.pipe(Stream.take(1), Stream.runCollect)
  console.log('message', message) // => 'Hello from A'
})
```

## Important notes

- Each node name needs to be unique in the network.
  - The node name is also used as a "tie-breaker" as part of the messaging protocol.
- It's using the `WebChannel` concept from the `@livestore/utils` package.
- We assume network edges to be low-latency (a few ms)
- Webmesh is used in LiveStore as the foundation for the LiveStore devtools protocol communication.
- The implementation should avoid timeout-based "solutions" as much as possible.

## Tradeoffs

- Webmesh isn't meant for larger networks
- Nodes are mostly stateless to simplify the protocol / implementation

## Inspiration

- Elixir `Distribution` / OTP
  - https://elixirschool.com/en/lessons/advanced/otp_distribution
	- https://serokell.io/blog/elixir-otp-guide
- Consul by HashiCorp
- Ethernet