# `@livestore/sync-cf`

## Transports

| Transport           | Connection      | Encoding  | Runtime Env                                 |
|---------------------|----------------|-----------|---------------------------------------------|
| WebSocket           | Stateful       | JSON      | Anywhere                                    |
| HTTP                | Stateless      | JSON      | Anywhere                                    |
| Durable Object RPC  | Stateful       | MsgPack   | Only available between Durable Objects (DOs) |

### WebSocket

```
┌─────────────┐  WS (hibernated) ┌─────────────┐
│   Client    │ ──────────────── │  Sync DO    │
└─────────────┘                  └─────────────┘
```

- Can send poke message

### HTTP

```
┌─────────────┐      HTTP       ┌─────────────┐
│   Client    │ ─────────────── │  Sync DO    │
└─────────────┘                 └─────────────┘
```

- Request-response model for each RPC call
- Streaming responses are implemented via HTTP streaming
  - Requires `enable_request_signal` compatibility flag to properly support `pull` streaming responses
  - Keeps DO alive for the duration of the stream (which causes CPU billing)


### Durable Object RPC

```
┌─────────────┐     DO RPC      ┌─────────────┐
│ DO Client   │ ─────────────── │  Sync DO    │
└─────────────┘                 └─────────────┘
```

- Only supported from client DOs
- RPC streams are implement via `ReadableStream` which is billed for the entire duration of the stream, not just the time it takes to send the data

## TODO (in readme)

- possibly add a CF Queue based transport mechanism for pull streaming responses
- alternative for DO RPC streams: poke to pull (let server callback client DO via client-side RPC endpoint)