# @livestore/webmesh

Webmesh is a library for connecting multiple nodes (windows/tabs, workers, threads, ...) in a network-like topology. It helps to establish end-to-end communication channels between nodes either by proxying messages via hop nodes or by establishing an end-to-end `MessageChannel` with support for transferable objects (e.g. `Uint8Array`) when possible.

It's used in LiveStore as the foundation for the LiveStore devtools protocol communication.

## Available connection implementations

- `MessageChannel`
- `BroadcastChannel` (both web and Node.js)
- `WebSocket`
- `window.postMessage`

## Important notes

- Each node name needs to be unique in the network.
  - The node name is also used as a "tie-breaker" as part of the messaging protocol.
- It's using the `WebChannel` concept from the `@livestore/utils` package.

## Inspiration

- Elixir `Distribution` / OTP
  - https://elixirschool.com/en/lessons/advanced/otp_distribution
	- https://serokell.io/blog/elixir-otp-guide
- Consul by HashiCorp
- Ethernet