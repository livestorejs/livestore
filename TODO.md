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

## Next steps 2025-08-16

- [ ] Refactor `SyncProvider` types
  - [ ] Rename to `SyncProvider` instead of `SyncBackend`
- [ ] CF DO adapter
  - [ ] Clean up CF DO client adapter example
  - [ ] Write docs for CF DO client adapter
  - [ ] Get rid of (or minimize) adapter `polyfill.ts`
- [ ] Lay foundation for S2 sync backend
- [ ] Refactor `@livestore/sync-cf`
  - [ ] Make `pull` DB querying streaming based
  - [ ] Refactor DO RPC transport streaming implementation to be "poking-to-pull" based
  - [ ] Move DO related files into `worker/durable-object` directory
  - [ ] Introduce Effect layer for common data (e.g. storage, storeId, etc)
  - [ ] Make storage (local SQLite vs D1) configurable
- Sync provider tests
  - [ ] Write more sync provider tests
  - [ ] Tests for concurrent pulls / sequential pushes
  - [ ] Property-based testing for various non-happy path scenarios / chaos testing
  - [ ] Make Electric sync provider tests stateless (i.e. reset docker compose containers between tests)
  - [ ] Test `payload` parameter
  - [ ] Sometimes tests "get stuck" / don't finish
  - [ ] Performance/load testing
- Cleanup work
  - [ ] Reduce logs of sync provider tests

## Future work

### Cloudflare

- [ ] Allow for Sync DO and client DO to be deployed via separate workers
- [ ] Support for read replicas