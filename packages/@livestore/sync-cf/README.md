# `@livestore/sync-cf`

## Transports

| Transport           | Connection      | Encoding  | Runtime Env                                 |
|---------------------|----------------|-----------|---------------------------------------------|
| Durable Object RPC  | Stateful       | MsgPack   | Only available between Durable Objects (DOs) |
| WebSocket           | Stateful       | JSON      | Anywhere                                    |
| HTTP                | Stateless      | JSON      | Anywhere                                    |

### Durable Object RPC

- Only supported from client DOs

### WebSocket

- Can send poke message

### HTTP

- Request-response model for each RPC call
- Streams are handled via pagination requests
- Requires `enable_request_signal` compatibility flag to properly support `pull` streaming responses