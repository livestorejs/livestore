---
"@livestore/livestore": minor
---

Lossless baseline for the handcrafted 0.4.0 release notes. Keep this file in sync with `CHANGELOG.md` until the supervised 0.4.0 release consumes it.

## 0.4.0 (Unreleased)

> For v0.4.0 features, see the development documentation at [dev.docs.livestore.dev](https://dev.docs.livestore.dev) which includes the latest documentation.

> **Installing v0.4.0 dev release:** Use the `dev` tag to install the latest development version. Make sure all LiveStore packages use the same version:
>
> ```bash
> pnpm add @livestore/livestore@dev @livestore/adapter-web@dev @livestore/wa-sqlite@dev @livestore/react@dev
> # Or for Cloudflare
> pnpm add @livestore/livestore@dev @livestore/adapter-cloudflare@dev @livestore/sync-cf@dev
> ```

### Highlights

- **New Cloudflare adapter:** Added the Workers/Durable Object adapter and rewrote the sync provider so LiveStore ships WebSocket, HTTP, and Durable Object RPC transports as first-party Cloudflare options (#528, #591).
- **S2 sync backend:** Map LiveStore's event log onto S2's durable stream store via `@livestore/sync-s2`, unlocking scalable basins/streams, SSE live tails, and transport-safe batching for large sync workloads (#292, #709).
- **Schema-first tables:** LiveStore now accepts Effect schema definitions as SQLite table definitions, removing duplicate column configuration in applications (#544).
- **Cloudflare sync provider storage:** Default storage is now Durable Object (DO) SQLite, with an explicit option to use D1 via a named binding. Examples and docs updated to the DO‑by‑default posture (see issue #266, #693).
- **MCP support:** LiveStore now ships a CLI with a first-class MCP server so automation flows can connect to instances, query data, and commit events using the bundled tools (#705).
- **React multi-store API:** The multi-store API is now the primary React integration, replacing `<LiveStoreProvider>` with `<StoreRegistryProvider>` and `useStore()` with store options. The new API supports multiple stores, preloading, and caching out of the box. See the [React integration docs](https://dev.docs.livestore.dev/reference/framework-integrations/react-integration/) (#841).

### Breaking Changes

- **`store.shutdown` API:** The shutdown method now returns an Effect instead of a Promise. Use `yield* store.shutdown()` inside Effects or `await store.shutdownPromise()` when a Promise is needed.

  ```typescript
  // Before
  await store.shutdown()

  // After (Effect API)
  yield * store.shutdown()

  // Or use the Promise helper
  await store.shutdownPromise()
  ```

- **`store.subscribe` callback signature:** The subscription callback is now passed as the second argument, with subscription options moved to an optional third argument object. Replace usages like `store.subscribe(query$, { onUpdate })` with `store.subscribe(query$, onUpdate, options)`.

- **`QueryBuilder.first()` behaviour:** `table.query.first()` now returns `undefined` when no rows match. To keep the old behaviour, pass `{ behaviour: "error" }`, or supply a fallback.

  ```typescript
  // Before: threw an error when no rows matched
  const user = table.query.first() // throws

  // After: returns undefined when no rows match
  const user = table.query.first() // returns undefined

  // To preserve old behaviour
  const strictUser = table.query.first({ behaviour: 'error' })

  // Or provide a fallback value
  const fallbackUser = table.query.first({
    behaviour: 'fallback',
    fallback: () => ({ id: 'default', name: 'Guest' }),
  })
  ```

- **Raw SQL event availability:** The `livestore.RawSql` event is no longer added automatically. Define it explicitly when needed (#469):

  ```typescript
  import { Events, Schema } from '@livestore/livestore'

  const rawSqlEvent = Events.clientOnly({
    name: 'livestore.RawSql',
    schema: Schema.Struct({
      sql: Schema.String,
      bindValues: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Any })),
      writeTables: Schema.optional(Schema.ReadonlySet(Schema.String)),
    }),
  })
  ```

- **wa-sqlite version alignment:** `@livestore/wa-sqlite` now follows LiveStore's versioning scheme to keep adapters on matching releases.

  ```bash
  # Before: wa-sqlite had independent versioning
  pnpm add wa-sqlite@1.0.5

  # After: wa-sqlite follows LiveStore versioning
  pnpm add @livestore/wa-sqlite@dev
  ```

  This change affects projects that directly depend on wa-sqlite. Most users rely on it indirectly through LiveStore adapters and don't need to change anything.

- **Cloudflare sync provider storage selection:** Removed implicit D1 auto‑selection and env‑based fallbacks. D1 must be selected explicitly via `storage: { _tag: 'd1', binding: 'DB' }` on the sync Durable Object. The default is DO SQLite (see issue #266, #693).

  Before (implicit D1 when env.DB was present):

  ```ts
  export class SyncBackendDO extends makeDurableObject({
    // storage engine auto‑selected based on env
  }) {}
  ```

  After (explicit binding for D1):

  ```ts
  // wrangler.toml
  // [[d1_databases]]
  // binding = "DB"
  // database_name = "your-db"
  // database_id = "..."

  // code
  export class SyncBackendDO extends makeDurableObject({
    storage: { _tag: 'd1', binding: 'DB' },
  }) {}
  ```

  To use the default DO SQLite, omit the `storage` option or pass `{ _tag: 'do-sqlite' }`.

- **Restructured `LiveStoreEvent` and `EventSequenceNumber` APIs:** Types are now organized into symmetric `Global`, `Client`, and `Input` namespaces that clarify the distinction between sync backend format, client format, and events without sequence numbers (#855):

  | Old Name                                        | New Name                                        |
  | ----------------------------------------------- | ----------------------------------------------- |
  | `LiveStoreEvent.AnyEncodedGlobal`               | `LiveStoreEvent.Global.Encoded`                 |
  | `LiveStoreEvent.AnyEncoded`                     | `LiveStoreEvent.Client.Encoded`                 |
  | `LiveStoreEvent.AnyDecoded`                     | `LiveStoreEvent.Client.Decoded`                 |
  | `LiveStoreEvent.PartialAnyEncoded`              | `LiveStoreEvent.Input.Encoded`                  |
  | `LiveStoreEvent.PartialAnyDecoded`              | `LiveStoreEvent.Input.Decoded`                  |
  | `LiveStoreEvent.EncodedWithMeta`                | `LiveStoreEvent.Client.EncodedWithMeta`         |
  | `EventSequenceNumber.GlobalEventSequenceNumber` | `EventSequenceNumber.Global`                    |
  | `EventSequenceNumber.globalEventSequenceNumber` | `EventSequenceNumber.Global.make`               |
  | `EventSequenceNumber.localEventSequenceNumber`  | `EventSequenceNumber.Client.make`               |
  | `EventSequenceNumber.clientDefault`             | `EventSequenceNumber.Client.DEFAULT`            |
  | `EventSequenceNumber.rebaseGenerationDefault`   | `EventSequenceNumber.REBASE_GENERATION_DEFAULT` |
  | `LiveStoreEvent.EventDefPartialSchema`          | `LiveStoreEvent.EventDefInputSchema`            |
  | `LiveStoreEvent.makeEventDefPartialSchema`      | `LiveStoreEvent.makeEventDefInputSchema`        |

  ```typescript
  // Before
  import { LiveStoreEvent, EventSequenceNumber } from '@livestore/livestore'
  const event: LiveStoreEvent.AnyEncoded = { ... }
  const globalSeq: EventSequenceNumber.GlobalEventSequenceNumber = 1

  // After
  import { LiveStoreEvent, EventSequenceNumber } from '@livestore/livestore'
  const event: LiveStoreEvent.Client.Encoded = { ... }
  const globalSeq: EventSequenceNumber.Global = 1
  ```

- **Error class rename:** `UnexpectedError` has been renamed to `UnknownError` for better semantic clarity and consistency with Effect ecosystem naming conventions. The previous name conflicted with Effect's terminology where "unexpected errors" refer to defects, while this error type represents errors of unknown type from external libraries or infrastructure failures (See [PR #823](https://github.com/livestorejs/livestore/pull/823)).

  Update all references:
  - Class name: `UnexpectedError` → `UnknownError`
  - Error tag: `'LiveStore.UnexpectedError'` → `'UnknownError'`
  - Static methods: `mapToUnexpectedError*` → `mapToUnknownError*`
  - Related type: `MergeResultUnexpectedError` → `MergeResultUnknownError`

  ```typescript
  // Before
  import { UnexpectedError } from '@livestore/common'

  effect.pipe(UnexpectedError.mapToUnexpectedError)

  // After
  import { UnknownError } from '@livestore/common'

  effect.pipe(UnknownError.mapToUnknownError)
  ```

- **React integration API:** The multi-store API is now the primary React integration, replacing `<LiveStoreProvider>` and the old `useStore()`. The new API uses `StoreRegistry`, `<StoreRegistryProvider>`, and `useStore()` with store options. See the [React integration docs](https://dev.docs.livestore.dev/reference/framework-integrations/react-integration/) for full details (#841).

  | Before                                           | After                                                                   |
  | ------------------------------------------------ | ----------------------------------------------------------------------- |
  | `<LiveStoreProvider schema={...} adapter={...}>` | `<StoreRegistryProvider storeRegistry={...}>` + `storeOptions({ ... })` |
  | `const { store } = useStore()`                   | `const store = useStore({ ... })`                                       |
  | `useQuery(query$)`                               | `store.useQuery(query$)`                                                |

  ```tsx
  // Before
  import { LiveStoreProvider, useStore, useQuery } from '@livestore/react'

  const App = () => (
    <LiveStoreProvider schema={schema} adapter={adapter} batchUpdates={batchUpdates}>
      <MyComponent />
    </LiveStoreProvider>
  )

  const MyComponent = () => {
    const { store } = useStore()
    const todos = useQuery(visibleTodos$)
    // ...
  }

  // After
  import { StoreRegistry } from '@livestore/livestore'
  import { StoreRegistryProvider, useStore } from '@livestore/react'

  const useAppStore = () =>
    useStore({
      storeId: 'app-root',
      schema,
      adapter,
      batchUpdates,
    })

  const App = () => {
    const [storeRegistry] = useState(() => new StoreRegistry())
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <MyComponent />
        </StoreRegistryProvider>
      </Suspense>
    )
  }

  const MyComponent = () => {
    const store = useAppStore()
    const todos = store.useQuery(visibleTodos$)
    // ...
  }
  ```

- **Removed top-level React hook exports:** `useQuery`, `useQueryRef`, and `useClientDocument` are no longer exported at the top level from `@livestore/react`. Use the store methods instead (#946):

  ```typescript
  // Before
  import { useQuery, useClientDocument } from '@livestore/react'
  const todos = useQuery(query$)
  const [state, setState] = useClientDocument(table)

  // After
  import { useStore } from '@livestore/react'

  const store = useStore(storeOptions) // or via a custom hook wrapping useStore() (e.g. useAppStore())
  const todos = store.useQuery(query$)
  const [state, setState] = store.useClientDocument(table)
  ```

  Type exports (`UseClientDocumentResult`, `Dispatch`, `SetStateAction`, etc.) remain available.

- **S2 proxy helper signature changes:** The `getSSEHeaders` and `getPushHeaders` functions in `@livestore/sync-s2/s2-proxy-helpers` now accept an `S2Config` object instead of a token string. This enables s2-lite support via the new `lite` flag which adds the `S2-Basin` header for self-hosted S2 deployments (#978).

  ```typescript
  // Before
  import * as S2Helpers from '@livestore/sync-s2/s2-proxy-helpers'
  const headers = S2Helpers.getSSEHeaders(token)
  const pushHeaders = S2Helpers.getPushHeaders(token)

  // After
  const config: S2Helpers.S2Config = { basin: 'my-basin', token: 'my-token' }
  const headers = S2Helpers.getSSEHeaders(config)
  const pushHeaders = S2Helpers.getPushHeaders(config)

  // For s2-lite (self-hosted), add the lite flag:
  const liteConfig: S2Helpers.S2Config = {
    basin: 'my-basin',
    token: 'unused',
    accountBase: 'http://localhost:4566/v1',
    basinBase: 'http://localhost:4566/v1',
    lite: true, // Adds S2-Basin header for s2-lite routing
  }
  ```

### Changes

#### Platform adapters

LiveStore now runs natively on Cloudflare Workers through the `@livestore/adapter-cloudflare` package. Durable Objects handle coordination and D1 provides persistence, enabling globally distributed applications with local-first behaviour. The adapter provides:

- Stateful Durable Objects for LiveStore instances
- D1 database integration for event persistence
- Hibernate-friendly architecture to minimise compute costs
- Direct integration with the Cloudflare sync provider

See the [Cloudflare adapter documentation](https://dev.docs.livestore.dev/reference/platform-adapters/cloudflare-durable-object-adapter/) for setup details and deployment guidance.

- Cloudflare adapter: Added a development-only reset persistence option to clear Durable Object state (#664).
- Node and Expo adapters: Added development-only reset persistence options to clear local state (#654).
- Web adapter: Archive development state databases with bounded retention to avoid OPFS exhaustion (#649, thanks @IGassmann).

#### Sync provider

The `@livestore/sync-cf` package has been rewritten to offer three first-party transports—WebSocket, HTTP, and Durable Object RPC—so Cloudflare deployments can choose the right balance of latency and infrastructure support:

- **WebSocket transport:** Bidirectional real-time communication with automatic reconnection
- **HTTP transport:** Request/response sync with polling for environments that can’t keep WebSocket connections open
- **Durable Object RPC:** Direct Durable Object calls that avoid network overhead entirely

Key improvements include streaming pull operations (faster initial sync), a two-phase sync (bulk transfer followed by real-time updates), improved error recovery, and comprehensive test coverage.

- **Storage engine configuration:** Default storage is DO SQLite; configure D1 explicitly with `storage: { _tag: 'd1', binding: '<binding>' }`. Removed env‑based fallback detection. Docs include a “Storage engines” section, and examples default to DO storage (see issue #266).
- **DO SQLite insert batching:** Adjusted insert chunk size to stay under parameter limits for large batches.

- WebSocket transport: Introduced message chunking limits to stay under platform constraints (#687).
- Reliability: Retry and backoff on push errors, restart push on advance, and add regression tests (#639).
- Resilience: Improve sync provider robustness and align test helpers for CI and local development (#682, #646).
- Header forwarding: Added `forwardHeaders` option to `makeDurableObject()` for cookie-based authentication. Headers are stored in WebSocket attachments to survive hibernation and accessible via `context.headers` in `onPush`/`onPull` callbacks (#929).
- **Backend reset detection:** LiveStore now detects when a sync backend has been reset and handles it based on the `onBackendIdMismatch` option in `SyncOptions`. Default behaviour (`'reset'`) clears local storage and shuts down so the app can restart with fresh data. Alternative modes include `'shutdown'` (shut down without clearing) and `'ignore'` (continue with stale data). See [Backend Reset Detection docs](https://livestore.dev/building-with-livestore/syncing#backend-reset-detection) (#980).

##### S2 sync backend

LiveStore now ships `@livestore/sync-s2`, a first-party integration with S2—the stream store that exposes basins and append-only streams over HTTP and SSE. LiveStore maps each `storeId` onto its own S2 stream while keeping LiveStore's logical sequencing inside the payload, so teams gain provider-managed durability, retention policies, and elastic fan-out without retooling their event model (#292). The provider still expects an authenticated proxy that provisions basins/streams, forwards LiveStore pushes and pulls, and translates S2 cursors back into LiveStore metadata.

- **Stream primitives:** Helper utilities (`ensureBasin()`, `ensureStream()`, `makeS2StreamName()`) manage S2 provisioning and naming so apps can wire up a single `/api/s2` entry point without manual HTTP plumbing (#292).
- **Live pull over SSE:** The client understands S2's `batch`, `ping`, and `error` SSE events, keeping live cursors in sync while avoiding dropped connections and manual tail loops (#292).
- **Transport-safe batching:** Append helpers respect S2's 1 MiB / 1000-record limits, preventing 413 responses while you stream large batches into managed storage (#709).
- **s2-lite support:** Added support for [s2-lite](https://github.com/s2-streamstore/s2-lite), the open-source self-hosted S2. Set `lite: true` in `S2Config` to enable header-based basin routing. CI tests now run against s2-lite, removing the dependency on hosted S2 credentials (#978).

See the [S2 sync provider docs](https://dev.docs.livestore.dev/reference/syncing/sync-provider/s2/) for full deployment guidance and operational notes.

#### Core Runtime & Storage

- **Event log lookup optimization:** Improved event log lookup performance for large unsynced logs, speeding startup time ([#1012](https://github.com/livestorejs/livestore/pull/1012)).

- **Unknown event handling:** Schemas now ship an `unknownEventHandling` configuration so older clients can warn, ignore, fail, or forward telemetry when they see future events while keeping the eventlog intact ([#353](https://github.com/livestorejs/livestore/issues/353)).

- **Schema-first tables:** LiveStore now accepts Effect schema definitions as SQLite table inputs, keeping type information and stored schema in the same place. For example:

  ```typescript
  // Define your schema
  const Recipe = Schema.Struct({
    id: Schema.String.pipe(State.SQLite.withPrimaryKey),
    name: Schema.String,
    createdAt: Schema.String.pipe(State.SQLite.withDefault(() => 'CURRENT_TIMESTAMP')),
  })

  // Create table with automatic column inference
  const recipes = State.SQLite.table({
    name: 'recipes',
    schema: Recipe,
  })
  ```

  This keeps the schema as a single source of truth, enforces types at compile time, and removes duplicate column definitions.

- **Materializer hash checks:** Development builds compute hashes for materializer output and raise `MaterializerHashMismatchError` when handlers diverge, catching non-pure implementations before they reach production.

  ```typescript
  // This triggers warnings in development
  const materializers = State.SQLite.materializers(events, {
    todoCreated: (payload) => {
      const id = nanoid() // Non-pure: different ID each call
      const timestamp = Date.now() // Non-pure: uses external state

      return todos.insert({
        id,
        ...payload,
        createdAt: timestamp,
      })
    },

    // Pure materializer - no warnings
    userRegistered: (payload) => users.insert(payload),
  })
  ```

  Pure materializers ensure deterministic replay during sync, improve test reliability, and make debugging predictable.

- **Event deprecation support:** Mark entire events or individual fields as deprecated to guide schema evolution. When deprecated events are committed or deprecated fields have values, a warning is logged via Effect's logging system to help teams migrate away from legacy patterns (#956).

  ```typescript
  import { Events } from '@livestore/livestore'
  import { Schema } from 'effect'
  import { deprecated } from '@livestore/common/schema'

  // Field-level deprecation
  const todoUpdated = Events.synced({
    name: 'v1.TodoUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      title: Schema.optional(Schema.String).pipe(deprecated("Use 'text' instead")),
      text: Schema.optional(Schema.String),
    }),
  })

  // Event-level deprecation
  const todoRenamed = Events.synced({
    name: 'v1.TodoRenamed',
    schema: Schema.Struct({ id: Schema.String, name: Schema.String }),
    deprecated: "Use 'v1.TodoUpdated' instead",
  })
  ```

#### API & DX

- **Per-store `unusedCacheTime` in `StoreRegistry`:** Each store managed by a `StoreRegistry` can now specify its own `unusedCacheTime` via `storeOptions()`, overriding the registry-level default. Short-lived ephemeral stores can be disposed quickly while persistent stores stay cached longer ([#917](https://github.com/livestorejs/livestore/issues/917)).
- **Store:** `store.networkStatus` now surfaces sync backend connectivity so apps can read the latest status or subscribe directly; the signal is no longer re-exposed on client sessions (livestorejs/livestore#394).
- `LiveStoreSchema.Any` type alias simplifies schema composition across adapters.
- Query builder const assertions improve type inference, and `store.subscribe()` now accepts query builders (#371, thanks @rgbkrk).
- **Store.subscribe async iteration:** The async iterator overload now exposes a first-class `AsyncIterable` so `for await` loops work without manual casts, and the new exported `Queryable` type documents the accepted inputs (livestorejs/livestore#736).
- **Queryable type export:** `packages/@livestore/livestore` now re-exports `Queryable<TResult>` so shared utilities and framework adapters can describe the exact shapes accepted by `store.subscribe` and `subscribeStream` (livestorejs/livestore#736).
- Store operations after shutdown are rejected with a descriptive `UnknownError`. Shutdown now returns an Effect (see breaking changes).
- Exact optional property types are enabled, surfacing missing optional handling at compile time (#600).
- Effect `Equal` and `Hash` implementations for `LiveQueryDef` and `SignalDef` improve comparisons.
- Sync payload and store ID are exposed to `onPull`/`onPush` handlers (#451).
- Materializers receive each event's `clientId`, simplifying multi-client workflows (#574).
- React peer dependency relaxed from exact to caret range for smoother upgrades (#621).
- **Effect integration:** Added `Store.Tag(schema, storeId)` API for idiomatic Effect usage. Returns a yieldable `Context.Tag` with static accessors (`query`, `commit`, `use`) and a `layer()` factory method. The previous `makeStoreContext()` and `LiveStoreContextLayer()` APIs are now deprecated:

  ```typescript
  import { Store } from '@livestore/livestore/effect'

  // Before (deprecated)
  const MainStoreContext = makeStoreContext<typeof schema>()('main')
  const MainStore = MainStoreContext.Tag
  const MainStoreLayer = MainStoreContext.Layer({ schema, adapter, ... })

  // After
  const TodoStore = Store.Tag(schema, 'todos')
  const TodoStoreLayer = TodoStore.layer({ adapter, batchUpdates })

  // Use in Effect code - yield directly or use static accessors
  Effect.gen(function* () {
    const { store } = yield* TodoStore
    const todos = yield* TodoStore.query(tables.todos.select())
    yield* TodoStore.commit(events.todoCreated({ id: '1', text: 'Buy milk' }))
  })
  ```

#### Bug fixes

##### Schema & Migration

- Fix client document schema migration with optimistic decoding (#588)
- Fix race condition in schema migration initialization (#566)
- Fix handling of optional fields without defaults in client documents (#487)

##### Query & Caching

- Fix query builder method order to preserve where clauses (#586)
- Fix Symbol values in QueryCache key generation
- Fix SQLite query builder clause order so LIMIT precedes OFFSET, preventing syntax errors (#882)

##### SQLite & Storage

- Fix SQLite connections not closed on store disposal, preventing database reset after file deletion in the Expo adapter ([#1171](https://github.com/livestorejs/livestore/issues/1171)). Thanks @OrkhanAlikhanov for the detailed repro.
- Fix in-memory SQLite database connection handling in Expo adapter
- Fix OPFS file pool capacity exhaustion from old state databases (#569)
- Upgrade wa-sqlite to SQLite 3.50.4 (#581)
- **WAL snapshot guard:** `@livestore/sqlite-wasm` now aborts WAL-mode snapshot imports with an explicit `SqliteError`, preventing silent corruption when loading backups ([#694](https://github.com/livestorejs/livestore/issues/694)).
- **Fix `changeset_apply` crash during rebase rollback:** The conflict callback was coerced to a null pointer when passed to WASM, causing `RuntimeError: function signature mismatch` during concurrent multi-tab edits. Now wired through the C adapter relay pattern matching other callback APIs. `xConflict` and `xFilter` are explicit parameters on the public API (#998). Thanks, @slashv for the detailed reproduction and @acusti for the initial investigation.

##### Concurrency & Lifecycle

- Fix `useStore` hook-order violation in React strict mode by moving the `retain` effect after the `React.use()` suspension point ([#1181](https://github.com/livestorejs/livestore/issues/1181))

- Fix background push fiber dying silently on non-`RejectedPushError` failures in `ClientSessionSyncProcessor`, leaving sessions unable to push ([#1133](https://github.com/livestorejs/livestore/issues/1133))
- Fix `toGlobal()` leaking a debug `toJSON` method onto the returned `Global.Encoded` object, causing `JSON.stringify` to produce string seqNums instead of integers in custom sync backends (#1165). Thanks @OrkhanAlikhanov for diagnosing the root cause.
- Fix correct type assertion in withLock function
- Fix finalizers execution order (#450)
- Ensure large batches no longer leave follower sessions behind by reconciling leader/follower heads correctly (#362)
- Detect sync backend identity mismatches after Cloudflare state resets and surface an actionable error instead of silent failure (#389)
- Stop advancing the backend head when materializers crash so subsequent boots no longer fail (#409)
- Prevent `store.subscribe` reentrancy crashes by restoring the reactive debug context after nested commits (#577, #656)
- Fix `subscribe` with `skipInitialRun` to properly register reactive dependencies while suppressing the initial callback (#847)
- Fix event equality check failing when args key order differs, which caused duplicate events when syncing with backends that reorder JSON keys (e.g. PostgreSQL `jsonb`) (#1160)

##### TypeScript & Build

- Fix TypeScript build issues and examples restructuring
- Fix TypeScript erasableSyntaxOnly compatibility issues (#459)
- **`table.insert()` now correctly omits nullable fields:** Schema-derived table definitions previously required all fields in `insert()` calls. Nullable columns (e.g. `S.NullOr`) are now correctly omittable, matching SQL semantics where nullable columns implicitly default to `NULL` (#1117).

#### Docs & Examples

- **New example: CF Chat:** A Cloudflare Durable Objects chat example demonstrates WebSocket sync, reactive message handling, and bot integrations across client React components and Durable Object services.
- Cloudflare examples now default to DO SQLite storage. D1 usage is documented via an explicit binding and a one‑line `storage` option in code.
- **Cloudflare Workers deployments:** `mono examples deploy` now provisions Worker targets so DO-backed demos stay current across prod and dev environments (#690, #735).
- Add Netlify dev deployments for examples to simplify testing (#684).
- **Svelte integration docs:** Added the Svelte framework guide plus the Svelte TodoMVC example so `@livestore/svelte` is documented alongside React and Solid.
- Use Twoslash for select getting started snippets in docs (#658).
- **TanStack Start examples:** `web-linearlite`, `web-todomvc-sync-electric`, and `web-todomvc-sync-s2` now run on TanStack Start with Vite 7 compatibility fixes and Cloudflare runtime flags (#747).
- **Docs for coding agents:** Documentation now serves agent-optimised Markdown so automations get concise answers without burning unnecessary tokens (#715).
- **TypeScript-validated snippets:** Most examples are now type checked through the Twoslash pipeline enabling in-docs intellisense (#715).

#### Experimental features

- LiveStore CLI for project scaffolding (experimental preview, not production-ready)

#### Updated (peer) dependencies

- Effect updated to 3.17.14
- React updated to 19.1.1
- Vite updated to 7.1.7
- TypeScript 5.9.2 compatibility

### Internal Changes

> Updates in this section are primarily relevant to maintainers and contributors. They cover infrastructure, tooling, and other non-user-facing work that supports the release.

#### Core Runtime

- Encapsulated Store internals behind `StoreInternalsSymbol` (moved `boot`, `syncProcessor`, `effectContext`, `tableRefs`, `otel`, `sqliteDbWrapper`, `clientSession`, `activeQueries`, `reactivityGraph`, `isShutdown`), reducing public surface and clarifying API boundaries ([#814](https://github.com/livestorejs/livestore/issues/814)).

#### Testing Infrastructure

- Comprehensive sync provider test suite with property-based testing (#386)
- Node.js sync test infrastructure with Wrangler dev server integration (#594)
- Parallel CI test execution reducing test time significantly (#523)
- Cloudflare sync provider tests run against both storage engines (D1 and DO SQLite) using separate wrangler configs.

#### Development Tooling

- **Strict peer dep composition:** Added `@effect/vitest` to `utilsEffectPeerDeps` and `@livestore/peer-deps`, and deduplicated the peer-deps package to derive its dependency list from the canonical `utilsEffectPeerDeps` source ([#1107](https://github.com/livestorejs/livestore/issues/1107)).
- Migration from ESLint to Biome for improved performance (#447)
- Automated dependency management with Renovate
- Pre-commit hooks via Husky (#522)
- Comprehensive dependency update script (#516)
- Add GitHub issue templates to improve issue quality (#602)
- Reworked the documentation tooling so maintainers continuously publish token-efficient, TypeScript-backed snippets that stay reliable for coding agents (#715)
- **Snapshot release confirmation prompt:** The `mono release snapshot` command now prompts for confirmation before publishing. Pass `--yes` to skip the prompt in scripts and CI. The prompt is also auto-skipped when `CI` is set (#1049).

#### wa-sqlite Integration

The wa-sqlite WebAssembly SQLite implementation has been integrated directly into the LiveStore monorepo as a git subtree under `packages/@livestore/wa-sqlite`. This change provides several benefits:

- Direct control over SQLite builds and customizations for LiveStore's needs
- Simplified dependency management and version alignment
- Ability to apply LiveStore-specific patches and optimizations
- Reduced external dependency risks and improved build reproducibility

Key changes:

- Integrated wa-sqlite as git subtree, replacing external npm dependency (#582)
- Ported build scripts and test infrastructure to LiveStore monorepo (#572)
- Updated to SQLite 3.50.4 with LiveStore-optimized configuration (#581)
- Fixed test setup issues and improved reliability (#583)

This integration lays the foundation for future SQLite optimizations specific to LiveStore's event-sourcing and sync requirements.

### Todo

For remaining v0.4.0 work and known issues, see the [v0.4.0 milestone on GitHub](https://github.com/livestorejs/livestore/milestone/8).

Open issues:

- Other tabs lag behind noticeably when committing large batches of events (#304)
- Vite DevTools consistently loses app connection (#331)
- Sync state memory leak: Unbounded pending events accumulation when no sync backend is used (#360)
- Type Annotations on schemas not portable (#383)
- store.shutdown() doesn't wait for pending writes to complete, causing data loss (#416)
- Consider mechanism to reject events on sync (#404)
- [Devtools] Clicking on session doesn't work (#474)
- Fix: Rolling back empty materializers currently fails
