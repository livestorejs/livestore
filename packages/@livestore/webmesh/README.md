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

## Important notes

- Each node name needs to be unique in the network.
  - The node name is also used as a "tie-breaker" as part of the messaging protocol.
- It's using the `WebChannel` concept from the `@livestore/utils` package.
- We assume network edges to be low-latency (a few ms)
- Webmesh is used in LiveStore as the foundation for the LiveStore devtools protocol communication.

## Tradeoffs

- Webmesh isn't meant for larger networks
- Nodes are mostly stateless to simplify the protocol / implementation

## Inspiration

- Elixir `Distribution` / OTP
  - https://elixirschool.com/en/lessons/advanced/otp_distribution
	- https://serokell.io/blog/elixir-otp-guide
- Consul by HashiCorp
- Ethernet