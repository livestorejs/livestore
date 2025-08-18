# With Cloudflare help

- [x] Make `sqlite-wasm/load-wasm` work properly for the `workerd` module (and remove workaround in `mod.browser.ts`) https://github.com/cloudflare/workers-sdk/issues/10094
- [ ] WS connection best practices between sync backend and client
  - Embrace queues?
- [ ] Feedback for API surface
- [ ] DO programatic lifecycle APIs
  - currently need to wait for 5 sec for it to go to sleep

- [ ] OOP interface for LiveStore
- [ ] type compatibility between `cloudflare:workers` and `@cloudflare/workers-types`

# Implementation

- [ ] Multiple stores in a single client DO

## Sync refactor

- Make sync transport layers pluggable in sync client 
- Transports
 - [ ] DO RPC
 - [ ] HTTP JSON-RPC
 - [ ] WebSocket

## Next steps 2025-08-16

- [ ] Rebase from `dev`
- [ ] Refactor `SyncProvider` types
  - [ ] Rename to `SyncProvider` instead of `SyncBackend`
  - [ ] use global event sequence number for cursor instead of client sequence number
- [ ] Refactor `@livestore/sync-cf`
  - [ ] Refactor CF WS transport
  - [ ] Make `pull` implementation streaming based
  - [ ] Move DO related files into `worker/durable-object` directory
- Sync provider tests
  - [ ] Write more sync provider tests
  - [ ] Property-based testing for various non-happy path scenarios / chaos testing
  - [ ] Make Electric sync provider tests stateless (i.e. reset docker compose containers between tests)
  - [ ] Test `payload` parameter
  - [ ] Sometimes tests "get stuck" / don't finish
  - [ ] Performance/load testing
- [ ] CF DO adapter
  - [ ] Clean up CF DO client adapter example
  - [ ] Write docs for CF DO client adapter
  - [ ] Get rid of (or minimize) adapter `polyfill.ts`
- [ ] Lay foundation for S2 sync backend
- [ ] Get rid of `compatibility_flags = ["nodejs_compat"]` in `wrangler.toml` (if possible)
- Cleanup work
  - [ ] Reduce logs of sync provider tests

## Future work

### Cloudflare

- [ ] Support for read replicas