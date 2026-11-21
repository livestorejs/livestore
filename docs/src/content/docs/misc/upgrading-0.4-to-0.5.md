---
title: Upgrading from 0.4 to 0.5 (Effect 3 → Effect 4)
description: Migrate LiveStore dependencies, schemas, commit callbacks and Cloudflare sync code to LiveStore 0.5.
---

LiveStore 0.5 uses **stable Effect 4**. Applications on LiveStore 0.4 and Effect 3 must update their dependencies and any Effect APIs they use, including schemas imported from LiveStore. This guide covers the application-facing changes. See the [changelog](https://github.com/livestorejs/livestore/blob/main/CHANGELOG.md) for the full release ledger.

## 1. Upgrade the dependency cohort together

Upgrade all `@livestore/*` packages used by your application to the same stable 0.5 release, including framework bindings, adapters and sync packages. Install `effect@^4.0.0`. Effect 3 and Effect 4 beta/RC releases do **not** satisfy this range. Do not mix stable 0.4 packages with the 0.5 cohort. See [package management](/misc/package-management/) for release channels and installation guidance.

For applications that use them, the remaining `@effect/opentelemetry`, `@effect/platform-browser`, `@effect/platform-bun`, `@effect/platform-node`, `@effect/platform-node-shared` and `@effect/vitest` peers also use `^4.0.0`. Check the peer dependencies of each package you install. Do not force an Effect-3-only dependency onto Effect 4 with an override: upgrade or replace it first. Confirm your lockfile resolves a compatible Effect version across your application, browser workers and server code.

Remove these obsolete Effect 3 peer packages **if they were installed only for LiveStore**: `@effect/ai`, `@effect/cli`, `@effect/cluster`, `@effect/experimental`, `@effect/platform`, `@effect/printer`, `@effect/printer-ansi`, `@effect/rpc`, `@effect/sql` and `@effect/typeclass`. Their APIs were consolidated into `effect` or replaced. Migrate your own imports before removing packages your code still uses. For example, import `HttpClient` from `effect/http` instead of `@effect/platform`, and `Rpc` from `effect/rpc` instead of `@effect/rpc`. If you tested an Effect 4 prerelease, migrate its `effect/unstable/*` imports to the stable module paths too.

Sources: [initial dependency migration #1322](https://github.com/livestorejs/livestore/pull/1322), [migration changeset #1359](https://github.com/livestorejs/livestore/pull/1359), [active-package alignment #1591](https://github.com/livestorejs/livestore/pull/1591), [stable Effect #1647](https://github.com/livestorejs/livestore/pull/1647). Consult the [Effect changelog](https://github.com/Effect-TS/effect/blob/main/packages/effect/CHANGELOG.md) for Effect APIs beyond LiveStore's surface.

## 2. Update event and state schemas

The following are API substitutions, not complete runnable examples. Historical code is shown as diff fragments because Effect 3 APIs cannot type-check against the current snippet workspace.

```diff
- Schema.Literal('all', 'active', 'completed')
+ Schema.Literals(['all', 'active', 'completed'])

- Schema.DateFromNumber
+ Schema.DateFromMillis

- Schema.DateFromEpochMillis
+ Schema.DateFromMillis
```

`DateFromEpochMillis` was a LiveStore-specific helper and is removed. `DateFromMillis` decodes epoch-millisecond numbers into JavaScript `Date` values. For a SQLite integer column, use `State.SQLite.integer({ schema: Schema.DateFromMillis })`. Refined Date and Uint8Array schemas continue to infer INTEGER and BLOB storage.

For string-encoded dates in synced events, keep **`Schema.DateFromString`**, not `Schema.Date`: decoded values are `Date` objects, while the event wire format is a string. The current [TodoMVC schema](/getting-started/react-web/) demonstrates this distinction. Do not rename existing event names or change their encoded payloads just to update an API spelling.

If you tried an Effect 4 prerelease, remove its now-obsolete validity check:

```diff
- Schema.DateFromString.check(Schema.isDateValid())
+ Schema.DateFromString
```

`DateFromString` and `DateFromMillis` reject invalid dates themselves. Other Effect refinements and transformations have changed names too. Review compiler errors against the Effect changelog rather than deleting application validation.

Sources: [mechanical schema migration #1323](https://github.com/livestorejs/livestore/pull/1323), [millisecond helper removal #1385](https://github.com/livestorejs/livestore/pull/1385), [event wire encoding #1436](https://github.com/livestorejs/livestore/pull/1436), [rc.111 schema migration #1585](https://github.com/livestorejs/livestore/pull/1585).

## 3. Return event arrays from commit callbacks

The callback no longer receives a `commit` function. Return the complete event batch synchronously. Direct `store.commit(event)` calls are unchanged.

```diff
- store.commit((commit) => { commit(eventA); commit(eventB) })
+ store.commit(() => [eventA, eventB])
```

Do not make the callback async. LiveStore collects the array before materialization, so a throwing callback applies no events. See the [store API](/building-with-livestore/store/) and [#1611](https://github.com/livestorejs/livestore/issues/1611), [#1623](https://github.com/livestorejs/livestore/pull/1623).

## 4. Update Cloudflare DO-RPC integrations

For `createStoreDo`, `createStoreDoPromise` and `makeDoRpcSync`, provide a factory that obtains a **fresh stub**, not a callback that returns a cached broken stub:

```diff
- syncBackendStub: env.SYNC_BACKEND_DO.getByName(storeId)
+ getSyncBackendStub: () => env.SYNC_BACKEND_DO.getByName(storeId)
```

Direct users of `makeDoRpcSync` must also pass `durableObjectState: this.ctx`. Forward reverse-RPC updates with `handleSyncUpdateRpc(this.ctx, payload)` instead of `handleSyncUpdateRpc(payload)`. Routing belongs to the client Durable Object instance.

To recover after client reconstruction, implement `syncUpdateRpc(payload, storeId)`, use that `storeId` to reopen the store, and then forward the update. A one-argument callback remains valid if you deliberately do not implement recovery. Follow the complete [Cloudflare adapter example](/platform-adapters/cloudflare-durable-object-adapter/) rather than forwarding updates to a store that has not booted. WebSocket and HTTP clients do not need the stub-factory migration.

Sources: [instance-scoped routing and client recovery #1545](https://github.com/livestorejs/livestore/pull/1545), [fresh-stub transport recovery #1649](https://github.com/livestorejs/livestore/pull/1649).

## 5. Remove obsolete configuration and utility APIs

| Previous API                                              | Migration                                                                                                                                           | Source                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| State migrations with `strategy: 'auto'` or `'manual'`    | Remove `strategy`. Keep supported hooks/logging. State is rebuilt automatically from the eventlog. Manual SQLite migration was unsupported.         | [#1525](https://github.com/livestorejs/livestore/pull/1525) |
| `Schema.DateFromEpochMillis` from the utils facade        | Use `Schema.DateFromMillis`.                                                                                                                        | [#1385](https://github.com/livestorejs/livestore/pull/1385) |
| `Encoding.encodeBase64Url` from `@livestore/utils/effect` | Use the facade's `Base64Url.encode`. For other encoding functions, use the corresponding Effect 4 module.                                           | [#1647](https://github.com/livestorejs/livestore/pull/1647) |
| `BucketQueue`, `ServiceContext` from the utils facade     | These LiveStore-local helpers are no longer exported. Replace custom integrations with appropriate Effect 4 queue/context APIs.                     | [#1359](https://github.com/livestorejs/livestore/pull/1359) |
| `Scheduler.messageChannel()`                              | Remove the custom override and use Effect's default `MixedScheduler`, unless your runtime needs its own scheduler.                                  | [#1370](https://github.com/livestorejs/livestore/pull/1370) |
| `TestSchema` from the utils facade                        | Import test helpers from `effect/testing`, not the browser runtime facade.                                                                          | [#1433](https://github.com/livestorejs/livestore/pull/1433) |
| `Effect.tryAll` from the utils facade                     | Use `Effect.trySyncOrPromiseOrEffect`. Promise rejections fail with `Cause.UnknownError`; returned Effects preserve their failure/service channels. | [#1527](https://github.com/livestorejs/livestore/pull/1527) |
| `Vitest.asProp` from the utils test helpers               | Use `Vitest.live.prop` with `arbitrary` options.                                                                                                    | [#1606](https://github.com/livestorejs/livestore/pull/1606) |

Custom Effect RPC integrations must also replace the removed MessagePack serialization with `SchemaBinary` ([#1606](https://github.com/livestorejs/livestore/pull/1606)). The built-in LiveStore transport already handles this. Upgrade clients and backend packages together rather than assuming mixed-version wire compatibility.

## 6. Plan the first open after deployment

The move to LiveStore-owned state fingerprints and rebuild-completion tracking causes a **one-time derived-state rebuild** when opening older stores. The eventlog and pending events are preserved. Do not reset storage to avoid this rebuild. Budget for replay duration and, on Cloudflare Durable Objects, SQLite row writes. Migration hooks must tolerate retries if a rebuild is interrupted. See [schema migrations](/building-with-livestore/state/sqlite-schema/#schema-migrations), [#1555](https://github.com/livestorejs/livestore/issues/1555) and [#1605](https://github.com/livestorejs/livestore/issues/1605).

This is separate from the Effect upgrade: an Effect-only upgrade preserves the new state fingerprint contract. Event definitions can get new schema hashes and emit mismatch warnings during rematerialization ([#63](https://github.com/livestorejs/livestore/issues/63)). Investigate genuine event-payload changes rather than treating all warnings as harmless.

Before deploying, type-check your application and workers against the new cohort, exercise replay of existing events, and test commits and sync with your upgraded backend. A fresh empty store alone does not exercise the upgrade path.
