## TODO

- [ ] Refactor `@livestore/sync-cf`
  - [ ] Make `pull` DB querying streaming based
  - [ ] Refactor DO RPC transport streaming implementation to be "poking-to-pull" based
  - [ ] Test deployed example
  - [ ] Introduce Effect layer for common data (e.g. storage, storeId, etc)
  - [ ] Make storage (local SQLite vs D1) configurable
  - [ ] Setup otel
  - [ ] get rid of `enable_request_signal` mentions as we're no longer using it
    - actually, we probably want to keep it for the first pull phase
- [ ] CF DO adapter (`@livestore/adapter-cloudflare`)
  - [ ] Clean up CF DO client adapter example
  - [ ] Write docs for CF DO client adapter
  - [ ] Support for LiveStore devtools
  - [ ] Get rid of (or minimize) adapter `polyfill.ts`
  - [ ] Create CF worker only example (without DO)
  - [ ] Test with multiple stores in a single client DO
- [ ] Lay foundation for S2 sync backend
- Sync provider tests
  - [ ] Write more sync provider tests
  - [ ] Tests for concurrent pulls / sequential pushes
  - [ ] Property-based testing for various non-happy path scenarios / chaos testing
  - [ ] Make Electric sync provider tests stateless (i.e. reset docker compose containers between tests)
  - [ ] Test `payload` parameter
  - [ ] Sometimes tests "get stuck" / don't finish
  - [ ] Performance/load testing
- Cleanup work
  - [ ] Figure out why `workerd` process is leaking (causes 99% CPU usage)
  - [ ] Move `supports` into `metadata` in `SyncBackend` type
  - [ ] Rename to `SyncProvider` instead of `SyncBackend`
  - [ ] Align naming of `@livestore/sync-cf` with `@livestore/adapter-cloudflare`
  - [ ] Reduce logs of sync provider tests

## Work notes

- Formed a stronger mental model of how Durable Objects work. Particularly re concurrency and hibernation.
- Tried out paths that didn't end up being viable:
  - HTTP-based streaming (required `enable_request_signal` compatibility flag). Worked but ended up keeping both client and server DOs alive for the whole duration of the pull (-> CPU billing)
  - DO RPC `ReadableStream` transport. Worked but ended up keeping both client and server DOs alive for the whole duration of the pull (-> CPU billing)
- Using DO Sqlite directly wasn't feasible
  - Now: Layered SQLite: using SQLite as Sqlite VFS
- Streaming and hibernatable reactivity are different things
- 2-phase pull streaming:
  - Phase 1: initial pull with all events from db as stream to improve latency. stream closes once all events are sent
  - Phase 2: Reactivity stream for new pushed events
- Core challenge:
  - How to model streaming so it's reactive but also allows for hibernation

## CF issues

- [ ] type compatibility between `cloudflare:workers` and `@cloudflare/workers-types`
- [ ] Otel support
- [ ] Visibility into / APIs for DO hibernation (during local development)

## Future work

### Other explorations

- [ ] Investigate using CF queues

### Cloudflare

- [ ] Allow for Sync DO and client DO to be deployed via separate workers
- [ ] Support for read replicas
- [ ] Enable support for WS transport for hibernated outgoing connections (see [workerd issue](https://github.com/cloudflare/workerd/issues/4864))