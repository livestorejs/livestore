# Changelog

> NOTE: LiveStore is still in beta and releases can include breaking changes.
> See
> [state of the project](https://docs.livestore.dev/evaluating/state-of-the-project/)
> for more info. LiveStore is following a semver-like release strategy where
> breaking changes are released in minor versions before the 1.0 release.

## 0.4.0 (Unreleased)

> For v0.4.0 features, see the development documentation at [dev.docs.livestore.dev](https://dev.docs.livestore.dev) which includes the latest documentation.

> **Installing v0.4.0 dev release:** Use the `dev` tag to install the latest development version. Make sure all LiveStore packages use the same version:
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

### Breaking Changes

- **`store.shutdown` API:** The shutdown method now returns an Effect instead of a Promise. Use `yield* store.shutdown()` inside Effects or `await store.shutdownPromise()` when a Promise is needed.

  ```typescript
  // Before
  await store.shutdown()

  // After (Effect API)
  yield* store.shutdown()

  // Or use the Promise helper
  await store.shutdownPromise()
  ```

- **`store.subscribe` callback signature:** The subscription callback is now passed as the second argument, with subscription options moved to an optional third argument object. Replace usages like `store.subscribe(query$, { onUpdate })` with `store.subscribe(query$, onUpdate, options)`.

- **`QueryBuilder.first()` behaviour:** `table.query.first()` now returns `undefined` when no rows match. To keep the old behaviour, pass `{ behaviour: "error" }`, or supply a fallback.

  ```typescript
  // Before: threw an error when no rows matched
  const user = table.query.first()  // throws

  // After: returns undefined when no rows match
  const user = table.query.first()  // returns undefined

  // To preserve old behaviour
  const strictUser = table.query.first({ behaviour: "error" })

  // Or provide a fallback value
  const fallbackUser = table.query.first({
    behaviour: "fallback",
    fallback: () => ({ id: "default", name: "Guest" })
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

##### S2 sync backend

LiveStore now ships `@livestore/sync-s2`, a first-party integration with S2—the stream store that exposes basins and append-only streams over HTTP and SSE. LiveStore maps each `storeId` onto its own S2 stream while keeping LiveStore's logical sequencing inside the payload, so teams gain provider-managed durability, retention policies, and elastic fan-out without retooling their event model (#292). The provider still expects an authenticated proxy that provisions basins/streams, forwards LiveStore pushes and pulls, and translates S2 cursors back into LiveStore metadata.

- **Stream primitives:** Helper utilities (`ensureBasin()`, `ensureStream()`, `makeS2StreamName()`) manage S2 provisioning and naming so apps can wire up a single `/api/s2` entry point without manual HTTP plumbing (#292).
- **Live pull over SSE:** The client understands S2's `batch`, `ping`, and `error` SSE events, keeping live cursors in sync while avoiding dropped connections and manual tail loops (#292).
- **Transport-safe batching:** Append helpers respect S2's 1 MiB / 1000-record limits, preventing 413 responses while you stream large batches into managed storage (#709).

See the [S2 sync provider docs](https://dev.docs.livestore.dev/reference/syncing/sync-provider/s2/) for full deployment guidance and operational notes.

#### Core Runtime & Storage

- **Unknown event handling:** Schemas now ship an `unknownEventHandling` configuration so older clients can warn, ignore, fail, or forward telemetry when they see future events while keeping the eventlog intact ([#353](https://github.com/livestorejs/livestore/issues/353)).

- **Schema-first tables:** LiveStore now accepts Effect schema definitions as SQLite table inputs, keeping type information and stored schema in the same place. For example:

  ```typescript
  // Define your schema
  const Recipe = Schema.Struct({
    id: Schema.String.pipe(State.SQLite.withPrimaryKey),
    name: Schema.String,
    createdAt: Schema.String.pipe(State.SQLite.withDefault(() => "CURRENT_TIMESTAMP"))
  })

  // Create table with automatic column inference
  const recipes = State.SQLite.table({
    name: "recipes",
    schema: Recipe
  })
  ```

  This keeps the schema as a single source of truth, enforces types at compile time, and removes duplicate column definitions.
- **Materializer hash checks:** Development builds compute hashes for materializer output and raise `LiveStore.MaterializerHashMismatchError` when handlers diverge, catching non-pure implementations before they reach production.

  ```typescript
  // This triggers warnings in development
  const materializers = State.SQLite.materializers(events, {
    todoCreated: (payload) => {
      const id = nanoid()        // Non-pure: different ID each call
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

#### API & DX

- **Store:** `store.networkStatus` now surfaces sync backend connectivity so apps can read the latest status or subscribe directly; the signal is no longer re-exposed on client sessions (livestorejs/livestore#394).
- `LiveStoreSchema.Any` type alias simplifies schema composition across adapters.
- Query builder const assertions improve type inference, and `store.subscribe()` now accepts query builders (#371, thanks @rgbkrk).
- Store operations after shutdown are rejected with a descriptive `UnexpectedError`. Shutdown now returns an Effect (see breaking changes).
- Exact optional property types are enabled, surfacing missing optional handling at compile time (#600).
- Effect `Equal` and `Hash` implementations for `LiveQueryDef` and `SignalDef` improve comparisons.
- Sync payload and store ID are exposed to `onPull`/`onPush` handlers (#451).
- Materializers receive each event's `clientId`, simplifying multi-client workflows (#574).
- React peer dependency relaxed from exact to caret range for smoother upgrades (#621).

#### Bug fixes

##### Schema & Migration

- Fix client document schema migration with optimistic decoding (#588)
- Fix race condition in schema migration initialization (#566)
- Fix handling of optional fields without defaults in client documents (#487)

##### Query & Caching

- Fix query builder method order to preserve where clauses (#586)
- Fix Symbol values in QueryCache key generation

##### SQLite & Storage

- Fix in-memory SQLite database connection handling in Expo adapter
- Fix OPFS file pool capacity exhaustion from old state databases (#569)
- Upgrade wa-sqlite to SQLite 3.50.4 (#581)
- **WAL snapshot guard:** `@livestore/sqlite-wasm` now aborts WAL-mode snapshot imports with an explicit `LiveStore.SqliteError`, preventing silent corruption when loading backups ([#694](https://github.com/livestorejs/livestore/issues/694)).

##### Concurrency & Lifecycle

- Fix correct type assertion in withLock function
- Fix finalizers execution order (#450)
- Ensure large batches no longer leave follower sessions behind by reconciling leader/follower heads correctly (#362)
- Detect sync backend identity mismatches after Cloudflare state resets and surface an actionable error instead of silent failure (#389)
- Stop advancing the backend head when materializers crash so subsequent boots no longer fail (#409)
- Prevent `store.subscribe` reentrancy crashes by restoring the reactive debug context after nested commits (#577, #656)

##### TypeScript & Build

- Fix TypeScript build issues and examples restructuring
- Fix TypeScript erasableSyntaxOnly compatibility issues (#459)

#### Docs & Examples

- **New example: CF Chat:** A Cloudflare Durable Objects chat example demonstrates WebSocket sync, reactive message handling, and bot integrations across client React components and Durable Object services.
- Cloudflare examples now default to DO SQLite storage. D1 usage is documented via an explicit binding and a one‑line `storage` option in code.
- **Cloudflare Workers deployments:** `mono examples deploy` now provisions Worker targets so DO-backed demos stay current across prod and dev environments (#690, #735).
- Add Netlify dev deployments for examples to simplify testing (#684).
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

#### Testing Infrastructure
- Comprehensive sync provider test suite with property-based testing (#386)
- Node.js sync test infrastructure with Wrangler dev server integration (#594)
- Parallel CI test execution reducing test time significantly (#523)
- Cloudflare sync provider tests run against both storage engines (D1 and DO SQLite) using separate wrangler configs.

#### Development Tooling
- Migration from ESLint to Biome for improved performance (#447)
- Automated dependency management with Renovate
- Pre-commit hooks via Husky (#522)
- Comprehensive dependency update script (#516)
- Add GitHub issue templates to improve issue quality (#602)
- Reworked the documentation tooling so maintainers continuously publish token-efficient, TypeScript-backed snippets that stay reliable for coding agents (#715)

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
- Improved multi-store support (#585)
- Fix: Rolling back empty materializers currently fails

## 0.3.0

### New features

- New sync implementation (based on git-like push/pull semantics)
  - See
    [Syncing docs page](https://livestore.dev/docs/reference/syncing/syncing/)
    for more details
  - `sync-cf` backend: More reliable websocket connection handling
  - Configurable sync semantics when app starts (either skip initial sync or
    block with timeout)

- New: Node adapter `@livestore/adapter-node` (experimental)
  - Note: Currently uses the `@livestore/sqlite-wasm` build but the plan is to
    move to a native SQLite build in the future to improve performance and
    reduce bundle size.
  - Still lacks a few devtools-related flows (e.g. graceful import/reset)

- New: `@livestore/sync-electric` backend (experimental)
  - See [docs page](https://livestore.dev/docs/reference/syncing/electricsql/)
    for more details

- New: `@livestore/adapter-expo` now supports syncing (requires Expo 53 or
  later):
  ```ts
  const adapter = makePersistedAdapter({
    sync: { backend: makeWsSync({ url: `https://...` }) },
  });
  ```

- New: Solid integration `@livestore/solid` (experimental)
  - Still very early stage and probably lacks some features. Feedback wanted!
  - Thank you to [@kulshekhar](https://github.com/kulshekhar) for the initial
    implementation! (See
    [PR #225](https://github.com/livestorejs/livestore/pull/225))
  - There are is still a lot of work to be done - contributions welcome!

### Breaking changes

- Breaking: Renamed adapter packages:
  - `@livestore/web` now is `@livestore/adapter-web`
  - `@livestore/expo` now is `@livestore/adapter-expo`
- Breaking: Removed `@livestore/db-schema` package and moved to
  `@livestore/common/schema`
- Breaking: Renamed `store.mutate` to `store.commit`
  - Reason: Make it more clear that committing mutations is also syncing them
    across other clients

- Breaking: Adjusted schema API

  - The new API aims to separate the schema into state and events
  - Mutations are now split up into event definitions and materializer functions

  Before:

  ```ts
  // mutations.ts
  import { defineMutation, Schema } from "@livestore/livestore";

  // Mutations are now split up into event definitions and materializer functions
  export const todoCreated = defineMutation(
    "todoCreated",
    Schema.Struct({
      id: DbSchema.text(),
      text: DbSchema.text(),
    }),
    sql`INSERT INTO todos (id, text) VALUES (${id}, ${text})`,
  );

  // schema.ts
  import { DbSchema, makeSchema } from "@livestore/livestore";
  import * as mutations from "./mutations.js";

  const todos = DbSchema.table("todos", {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text(),
  });

  const uiState = DbSchema.table("uiState", {
    id: DbSchema.text({ primaryKey: true }),
    newTodoText: DbSchema.text(),
    filter: DbSchema.text({}),
  }, {
    derivedMutations: { clientOnly: true },
  });

  const tables = { todos, uiState };
  const schema = makeSchema({ tables, mutations });
  ```

  After:

  ```ts
  // events.ts
  import { Events, Schema } from "@livestore/livestore";

  export const todoCreated = Events.synced({
    name: "todoCreated",
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  });

  // schema.ts
  import { makeSchema, Schema, State } from "@livestore/livestore";
  import * as events from "./events.js";

  const todos = State.SQLite.table({
    name: "todos",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
    },
  });

  // tables with `deriveMutations` are now called `clientDocuments`
  const uiState = State.SQLite.clientDocument({
    name: "uiState",
    schema: Schema.Struct({
      newTodoText: Schema.String,
      filter: Schema.String,
    }),
  });

  const tables = { todos, uiState };

  // Materalizers let you materialize events into the state
  const materializers = State.SQLite.materializers(events, {
    "v1.TodoCreated": ({ id, text }) => todos.insert({ id, text }),
  });

  // Currently SQLite is the only supported state implementation but there might be more in the future (e.g. pure in-memory JS, DuckDB, ...)
  const state = State.SQLite.makeState({ tables, materializers });

  // Schema is now more clearly separated into state and events
  const schema = makeSchema({ state, events });
  ```

- Breaking `@livestore/react`: Removed `useScopedQuery` in favour of `useQuery`.
  Migration example:
  ```ts
  // before
  const query$ = useScopedQuery(
    () => queryDb(tables.issues.query.where({ id: issueId }).first()),
    ["issue", issueId],
  );

  // after
  const query$ = useQuery(
    queryDb(tables.issues.query.where({ id: issueId }).first(), {
      deps: `issue-${issueId}`,
    }),
  );
  ```

- Breaking `@livestore/adapter-web`: Renamed `makeAdapter` to
  `makePersistedAdapter`
- Breaking `@livestore/adapter-expo`: Renamed `makeAdapter` to
  `makePersistedAdapter`
- Breaking: Renamed `localOnly` to `clientOnly` in table/mutation definitions.
- Breaking: Renamed `makeBackend` to `backend` in sync options.
- Breaking `@livestore/react`: `useClientDocument` now only works with for
  tables with client-only derived mutations.
- Breaking: Instead of calling `query$.run()` / `query$.runAndDestroy()`, please
  use `store.query(query$)` instead.
- Breaking: Removed `store.__execute` from `Store`.
- Breaking: Removed `globalReactivityGraph` and explicit passing of
  `reactivityGraph` to queries.
- Breaking: Removed `persisted` option from `store.commit`. This will be
  superceded by
  [eventlog compaction](https://github.com/livestorejs/livestore/issues/136) in
  the future.
- Breaking: The new syncing implementation required some changes to the storage
  format. The `liveStoreStorageFormatVersion` has been bumped to `3` which will
  create new database files.
- Breaking: Moved `queryGraphQL` to `@livestore/graphql` and thus removing
  `graphql` from peer dependencies of `@livestore/livestore`.
- Moved dev helper methods from e.g. `store.__devDownloadDb()` to
  `store._dev.downloadDb()`
- Breaking `@livestore/sync-cf`: Renamed `makeWsSync` to `makeWsSync`

### Notable improvements & fixes

- Added support for write queries in the query builder
  ```ts
  table.query.insert({ id: "123", name: "Alice" });
  table.query.insert({ id: "123", name: "Alice" }).onConflict("id", "ignore");
  table.query.insert({ id: "123", name: "Alice" }).returning("id");
  table.query.update({ name: "Bob" }).where({ id: "123" });
  table.query.delete().where({ id: "123" });
  ```

- Introduced `@livestore/peer-deps` package to simplify dependency management
  for Livestore packages if you don't want to manually install all the peer
  dependencies yourself.
- Improved [documentation](https://livestore.dev/) (still a lot of work to do
  here)
- Shows a browser dialog when trying to close a tab/window with unsaved changes
- The SQLite leader database now uses the WAL mode to improve performance and
  reliability. (Thanks [@IGassmann](https://github.com/IGassmann) for the
  contribution #259.)
- Improve Otel tracing integration
- Fix: The query builder now correctly handles `IN` and `NOT IN` where
  operations
- Fix: LiveStore crashes when using reserved keywords as a column name (`from`)
  #245

### Devtools

- Changed devtools path from `/_devtools.html` to `/_livestore`
- General connection stability improvements
- Improved sync view:
  - See sync heads in real-time
  - Connect/disconnect button
- Improved eventlog view:
  - Client-only mutations are now highlighted
  - Added `clientId` / `sessionId` columns
- Grouped slow queries and live queries under new queries tab
- Added SQLite query playground
- Fix: Data browser now more clearly highlights selected table #239

### Examples

- Reworked the Linearlite React example. (Thanks
  [@lukaswiesehan](https://github.com/lukaswiesehan) for the contribution #248.)
- Adjusted mutation names to use past-tense
- Added Otel to `todomvc` and `todomvc-sync-cf` example

### Internal changes

- Embraced git-style push/pull semantics to sync mutations across the system
- Added node syncing integration tests
- Got rid of the coordinator abstraction in favour of a clear separation between
  leader and client sessions
- Renamed from `EventId.local` to `EventSequenceNumber.client`
- Added `@livestore/sqlite-wasm` package which wraps `@livestore/wa-sqlite` and
  exposes web and Node.js compatible VFS implementations
- New devtools protocol via webmesh
  - Should improve reliability of devtools connection (particularly during app
    reloads)
- Large refactoring to share more code between adapters
- Renamed `SynchronousDatabase` to `SqliteDb`
- Upgrade to TypeScript 5.8
- Upgraded dependencies
  - Now supports React 19
  - `effect` (needs to be 3.15.2 or higher)
  - `@livestore/wa-sqlite` (needs to be 1.0.5)

### Still todo:

- Release
  - Write blog post
  - Prepare X/Bluesky thread

### After release:

- Refactor: Get rid of `sql-queries` module
- API improvement: Get rid of `queryDb` by exposing live queries directly on the
  query builder / state primitives
- Optimization: Bring back rehydrating via in-memory database (requires both app
  and mutation db to be in-memory)
- Web adapter:
  - Bug:
    `NotReadableError: The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.`
  - Refactor `shared-worker`
    - Make it optional (for Android support)
    - Make it store-agnostic (so it's reused across store instances)
    - Remove extra broadcast channel for session info in @livestore/adapter-web
- Bug fix + testing: SQLite rollback error:
  `RuntimeError: null function or function signature mismatch, "note": "Failed calling makeChangeset.apply`
  (needs repro info, probably requires property testing)
- Syncing:
  - introduce a way to know when an event is confirmed by the sync backend
  - when no sync backend is configured, the leader sync state should not keep
    `pending` events in memory
  - Testing: Improve sync testing (prop testing): introduce arbitrary latency
    for any kind of async step (~ chaos testing)
  - More graceful handling when receiving a event that doesn't exist in the
    local schema
    - This can happen if a new app version with a new schema and an old client
      with the old schema tries to sync
    - 2 solution paths:
      - Render "upgrade app" screen
      - Go offline until user upgrades the app
  - Clients should detect and gracefully handle when a sync backend resets its
    eventlog (e.g. during debugging)
    - possibly introduce a eventlog id in the global sync metadata
  - `@livestore/sync-cf`:
    - Opening the snyc HTTP endpoint in the browser should provide a helpful
      message
    - use http for initial pull while WS connection is established
    - Adjust networking protocol to embrace a "walk" flow similar to how
      ElectricSQL's protocol works. i.e. instead of doing 1 pull-req and getting
      n pull-res back, we will adjust this to be 1:1 at the expense of slightly
      higher round tripping overhead
      - We will "downgrade" the purpose of the `remaining` field to be only used
        for UX purposes but not for correctness purposes. For correctness we
        will only stop pull-walking when we get an empty array back.
    - Only use DO for write operations and pokes, use a separate way for
      pull-reqs
    - Bring back "broadcast" pull res terminology
  - `@livestore/sync-electric`:
    - fix: connectivity state + offline handling
    - implement sync payload
- Expo adapter: Fix memory leak in certain cases (needs repro info)
- Refactor/improve event sequence number implementation
  - Current pain points/suboptimalities:
    - `syncstate.ts`: branching for global/client-only events
    - Get rid of `leaderMergeCounterTable` in favour of client-only merge
      generation
      - Idea: Embed merge generation in the client-only event sequence number
      - Adjust leader + client session sync processor accordingly
    - Improve table schema for `eventlog` table (if possible)
- Examples:
  - setup: for todomvc, have a shared source of truth for the livestore
    definitions and have some scripts which copy them to the various example
    apps
  - add some docs/comments to the mutations / schema definitions + link to
    mutation best practices (+ mention of AI linting)
- Docs
  - Notes on deployment (when to deploy what)
  - Document event model/eventlog design
    - Unit of sharing/collaboration/auth
    - What if I want got my initial container design wrong and I want to change
      it?
      - Comparables: document databases, kafka streams,
- Devtools
  - Redesign with left sidebar
  - Databrowser:
    - custom handling for client-documents (i.e. render value subfields as
      columns) + allow value editing
  - Fix: When resetting the database but keeping the eventlog
    - on next app start, the app doesn't re-hydrate properly (somehow seems to
      "double hydrate")
  - support app reloading in Expo (requires an equivalent of `beforeunload` to
    be triggered in `makeClientSession`)
  - sync session appears for wrong storeid (needs repro info)
  - sync view:
    - different colors for when a node pulled/pushed
    - show status indicators in each node: uptodate/syncing/error
      - syncing should include the number of events still pending to push/pull
      - maybe we can also figure out how to get the sync backend status?
  - mutations explorer:
    - show client events as tree
    - always show root event s0

## 0.2.0

### Core

- Added query builder API

  ```ts
  const table = DbSchema.table("myTable", {
    id: DbSchema.text({ primaryKey: true }),
    name: DbSchema.text(),
  });

  table.query.select("name");
  table.query.where("name", "==", "Alice");
  table.query.where({ name: "Alice" });
  table.query.orderBy("name", "desc").offset(10).limit(10);
  table.query.count().where("name", "like", "%Ali%");
  table.get("123", { insertValues: { name: "Bob" } });
  ```

- Breaking: Renamed `querySQL` to `queryDb` and adjusted the signature to allow
  both the new query builder API and raw SQL queries:
  ```ts
  // before
  const query$ = querySQL(sql`select * from myTable where name = 'Alice'`, {
    schema: Schema.Array(table.schema),
  });

  // after (raw SQL)
  const query$ = queryDb({
    query: sql`select * from myTable where name = 'Alice'`,
    schema: Schema.Array(table.schema),
  });

  // or with the query builder API
  const query$ = queryDb(table.query.select("name").where({ name: "Alice" }));
  ```

- Breaking: Replaced `rowQuery()` with `table.get()` (as part of the new query
  builder API)

### React integration

- Fix: `useClientDocument` now type-safe for non-nullable/non-default columns.
  Renamed `options.defaultValues` to `options.insertValues`

### Misc

- Removed Drizzle example in favour of new query builder API
- Removed `livestore/examples` repository in favour of `/examples/standalone`
  (additionally `/examples/src` for maintainers)

## 0.1.0

### Core

- Breaking: Updated storage format version to 2 (will create new database files)

- Breaking: Changed `schema.key` to `storeId`
  [#175](https://github.com/livestorejs/livestore/issues/175)
  ```ts
  // before
  const schema = makeSchema({ tables, mutations, key: 'my-app-id' })
  // ...
  <LiveStoreProvider schema={schema} storeId="my-app-id">

  // after
  const schema = makeSchema({ tables, mutations })
  // ...
  <LiveStoreProvider schema={schema} storeId="my-app-id">
  ```

- Breaking: Removed `useLocalId` / `getLocalId` in favour of `store.sessionId` /
  `SessionIdSymbol`
- Upgraded dependencies
  - If you're using `effect` in your project, make sure to install version
    `3.10.x`
    - Note the new version of `effect` now includes `Schema` directly, so
      `@effect/schema` is no longer needed as a separate dependency. (See
      [Effect blog post](https://effect.website/blog/releases/effect/310/#effectschema-moved-to-effectschema).)

- Breaking: Moved `effect-db-schema` to `@livestore/db-schema` (mostly an
  internal change unless you're using the package directly)

- Breaking: Adjusted `boot` signature when creating a store to now pass in a
  `Store` instead of a helper database object
  ```tsx
  <LiveStoreProvider
    schema={schema}
    boot={(store) =>
      store.mutate(
        mutations.todoCreated({ id: nanoid(), text: "Make coffee" }),
      )}
    adapter={adapter}
    batchUpdates={batchUpdates}
  >
    // ...
  </LiveStoreProvider>;
  ```

- Prepared the foundations for the upcoming
  [rebase sync protocol](https://github.com/livestorejs/livestore/issues/195)
  - Implementation detail: New event id strategy (uses a global event id integer
    sequence number and each event also keeps a reference to its parent event
    id)

### React integration

- Breaking: The React integration has been moved into a new separate package:
  `@livestore/react` (before: `@livestore/livestore/react`)

- Breaking: Renamed `useTemporaryQuery` to `useScopedQuery`

### Web adapter

- Devtools address is now automatically logged during development making
  connecting easier. ![](https://i.imgur.com/nmkS9yR.png)

- Breaking: Changed syncing adapter interface:

  ```ts
  const adapter = makePersistedAdapter({
    storage: { type: "opfs" },
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
    syncBackend: {
      type: "cf",
      url: import.meta.env.VITE_LIVESTORE_SYNC_URL,
      roomId: `todomvc_${appId}`,
    },
  });
  ```

### Expo adapter

- Updated to Expo SDK 52 (`52.0.0-preview.23`)

- Fix: Crash in release builds
  [#206](https://github.com/livestorejs/livestore/issues/206)

- Fix: Disable devtools in release builds
  [#205](https://github.com/livestorejs/livestore/issues/205)

### Devtools

- Feature: New SQLite query playground ![](https://i.imgur.com/99zq6vk.png)

- Fix: Databrowser no longer crashes when removing tables
  [#189](https://github.com/livestorejs/livestore/issues/189)

- Breaking (in combination with web adapter): Removed `_devtools.html` in favour
  of `@livestore/devtools-vite`.
  [#192](https://github.com/livestorejs/livestore/issues/192)
  - Replace `@livestore/devtools-react` with `@livestore/devtools-vite` in your
    `package.json`
  - Delete `_devtools.html` if it exists
  - Add the following to your `vite.config.ts`:

    ```ts
    import { livestoreDevtoolsPlugin } from "@livestore/devtools-vite";

    export default defineConfig({
      // ...
      plugins: [
        // ...
        livestoreDevtoolsPlugin({ schemaPath: "./src/db/schema/index.ts" }),
        // ...
      ],
    });
    ```

### Misc

- Improved CI setup [#179](https://github.com/livestorejs/livestore/issues/179)
  [#166](https://github.com/livestorejs/livestore/issues/166)
