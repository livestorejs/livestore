# Changelog

> NOTE: LiveStore is still in alpha and releases can include breaking changes. See [state of the project](https://preview.livestore.dev/docs/reference/state-of-the-project/) for more info.
> LiveStore is following a semver-like release strategy where breaking changes are released in minor versions before the 1.0 release.

## 0.3.0

### New features

- New sync implementation (based on git-like push/pull semantics)
  - See [Syncing docs page](https://livestore.dev/docs/reference/syncing/syncing/) for more details
  - `sync-cf` backend: More reliable websocket connection handling
  - Configurable sync semantics when app starts (either skip initial sync or block with timeout)

- New: Node adapter `@livestore/adapter-node` (experimental)
  - Note: Currently uses the `@livestore/sqlite-wasm` build but the plan is to move to a native SQLite build in the future to improve performance and reduce bundle size.
  - Still lacks a few devtools-related flows (e.g. graceful import/reset)

- New: `@livestore/sync-electric` backend (experimental)
  - See [docs page](https://livestore.dev/docs/reference/syncing/electricsql/) for more details

- New: `@livestore/adapter-expo` now supports syncing (requires Expo 53 or later):
  ```ts
  const adapter = makePersistedAdapter({
    sync: { backend: makeCfSync({ url: `https://...` }) },
  })
  ```

- New: Solid integration `@livestore/solid` (experimental)
  - Still very early stage and probably lacks some features. Feedback wanted!
  - Thank you to [@kulshekhar](https://github.com/kulshekhar) for the initial implementation! (See [PR #225](https://github.com/livestorejs/livestore/pull/225))
  - There are is still a lot of work to be done - contributions welcome!

### Breaking changes

- Breaking: Renamed adapter packages:
  - `@livestore/web` now is `@livestore/adapter-web`
  - `@livestore/expo` now is `@livestore/adapter-expo`
- Breaking: Removed `@livestore/db-schema` package and moved to `@livestore/common/schema`
- Breaking: Renamed `store.mutate` to `store.commit`
  - Reason: Make it more clear that committing mutations is also syncing them across other clients

- Breaking: Adjusted schema API

  - The new API aims to separate the schema into state and events
  - Mutations are now split up into event definitions and materializer functions

  Before:

  ```ts
  // mutations.ts
  import { Schema, defineMutation } from '@livestore/livestore'

  // Mutations are now split up into event definitions and materializer functions
  export const todoCreated = defineMutation('todoCreated',
    Schema.Struct({
      id: DbSchema.text(),
      text: DbSchema.text(),
    }),
    sql`INSERT INTO todos (id, text) VALUES (${id}, ${text})`,
  )

  // schema.ts
  import { DbSchema, makeSchema } from '@livestore/livestore'
  import * as mutations from './mutations.js'

  const todos = DbSchema.table('todos', {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text(),
  })

  const uiState = DbSchema.table('uiState', {
    id: DbSchema.text({ primaryKey: true }),
    newTodoText: DbSchema.text(),
    filter: DbSchema.text({ }),
  }, {
    derivedMutations: { clientOnly: true }
  })

  const tables = { todos, uiState }
  const schema = makeSchema({ tables, mutations })
  ```

  After:

  ```ts
  // events.ts
  import { Events, Schema } from '@livestore/livestore'

  export const todoCreated = Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, }),
  })

  // schema.ts
  import { State, Schema, makeSchema } from '@livestore/livestore'
  import * as events from './events.js'

  const todos = State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
    }
  })

  // tables with `deriveMutations` are now called `clientDocuments`
  const uiState = State.SQLite.clientDocument({
    name: 'uiState',
    schema: Schema.Struct({
      newTodoText: Schema.String,
      filter: Schema.String,
    }),
  })

  const tables = { todos, uiState }

  // Materalizers let you materialize events into the state
  const materializers = State.SQLite.materializers(events, {
    'v1.TodoCreated': ({ id, text }) => todos.insert({ id, text }),
  })

  // Currently SQLite is the only supported state implementation but there might be more in the future (e.g. pure in-memory JS, DuckDB, ...)
  const state = State.SQLite.makeState({ tables, materializers })

  // Schema is now more clearly separated into state and events
  const schema = makeSchema({ state, events })
  ```

- Breaking `@livestore/react`: Removed `useScopedQuery` in favour of `useQuery`. Migration example:
  ```ts
  // before
  const query$ = useScopedQuery(() => queryDb(tables.issues.query.where({ id: issueId }).first()), ['issue', issueId])

  // after
  const query$ = useQuery(queryDb(tables.issues.query.where({ id: issueId }).first(), { deps: `issue-${issueId}` }))
  ```

- Breaking `@livestore/adapter-web`: Renamed `makeAdapter` to `makePersistedAdapter`
- Breaking `@livestore/adapter-expo`: Renamed `makeAdapter` to `makePersistedAdapter`
- Breaking: Renamed `localOnly` to `clientOnly` in table/mutation definitions.
- Breaking: Renamed `makeBackend` to `backend` in sync options.
- Breaking `@livestore/react`: `useClientDocument` now only works with for tables with client-only derived mutations.
- Breaking: Instead of calling `query$.run()` / `query$.runAndDestroy()`, please use `store.query(query$)` instead.
- Breaking: Removed `store.__execute` from `Store`.
- Breaking: Removed `globalReactivityGraph` and explicit passing of `reactivityGraph` to queries.
- Breaking: Removed `persisted` option from `store.commit`. This will be superceded by [eventlog compaction](https://github.com/livestorejs/livestore/issues/136) in the future.
- Breaking: The new syncing implementation required some changes to the storage format. The `liveStoreStorageFormatVersion` has been bumped to `3` which will create new database files.
- Breaking: Moved `queryGraphQL` to `@livestore/graphql` and thus removing `graphql` from peer dependencies of `@livestore/livestore`.
- Moved dev helper methods from e.g. `store.__devDownloadDb()` to `store._dev.downloadDb()`
- Breaking `@livestore/sync-cf`: Renamed `makeWsSync` to `makeCfSync`

### Notable improvements & fixes

- Added support for write queries in the query builder
  ```ts
  table.query.insert({ id: '123', name: 'Alice' })
  table.query.insert({ id: '123', name: 'Alice' }).onConflict('id', 'ignore')
  table.query.insert({ id: '123', name: 'Alice' }).returning('id')
  table.query.update({ name: 'Bob' }).where({ id: '123' })
  table.query.delete().where({ id: '123' })
  ```

- Introduced `@livestore/peer-deps` package to simplify dependency management for Livestore packages if you don't want to manually install all the peer dependencies yourself.
- Improved [documentation](https://livestore.dev/) (still a lot of work to do here)
- Shows a browser dialog when trying to close a tab/window with unsaved changes
- The SQLite leader database now uses the WAL mode to improve performance and reliability. (Thanks [@IGassmann](https://github.com/IGassmann) for the contribution #259.)
- Improve Otel tracing integration
- Fix: The query builder now correctly handles `IN` and `NOT IN` where operations
- Fix: LiveStore crashes when using reserved keywords as a column name (`from`) #245

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

- Reworked the Linearlite React example. (Thanks [@lukaswiesehan](https://github.com/lukaswiesehan) for the contribution #248.)
- Adjusted mutation names to use past-tense
- Added Otel to `todomvc` and `todomvc-sync-cf` example

### Internal changes

- Embraced git-style push/pull semantics to sync mutations across the system
- Added node syncing integration tests
- Got rid of the coordinator abstraction in favour of a clear separation between leader and client sessions
- Renamed field from `EventId.local` to `EventId.client`
- Added `@livestore/sqlite-wasm` package which wraps `@livestore/wa-sqlite` and exposes web and Node.js compatible VFS implementations
- New devtools protocol via webmesh
  - Should improve reliability of devtools connection (particularly during app reloads)
- Large refactoring to share more code between adapters
- Renamed `SynchronousDatabase` to `SqliteDb`
- Upgrade to TypeScript 5.8
- Upgraded dependencies
  - Now supports React 19
  - `effect` (needs to be 3.14.15 or higher)
  - `@livestore/wa-sqlite` (needs to be 1.0.5-dev.2)

### Still todo:

- Web adapter:
  - Same as node adapter
- Syncing
  - when no sync backend is configured, the leader sync state should not keep `pending` events in memory
  - Refactor: Rename `EventId` to `EventNumber`
  - Attempts sync push after read-model re-creation leading to some other bugs: (see https://share.cleanshot.com/hQ269Fkc)
  - More graceful handling when receiving a event that doesn't exist in the local schema
    - This can happen if a new app version with a new schema and an old client with the old schema tries to sync
    - 2 solution paths:
      - Render "upgrade app" screen
      - Go offline until user upgrades the app
  - introduce a way to know when an event is confirmed by the sync backend
  - cf sync:
    - use http for initial pull while WS connection is established
    - Adjust networking protocol to embrace a "walk" flow similar to how ElectricSQL's protocol works. i.e. instead of doing 1 pull-req and getting n pull-res back, we will adjust this to be 1:1 at the expense of slightly higher round tripping overhead
      - We will "downgrade" the purpose of the `remaining` field to be only used for UX purposes but not for correctness purposes. For correctness we will only stop pull-walking when we get an empty array back.
    - Bring back "broadcast" pull res terminology
  - Electric:
    - fix: connectivity state + offline handling
    - implement sync payload
  - Clients should detect and gracefully handle when a sync backend resets its eventlog (e.g. during debugging)
    - possibly introduce a eventlog id in the global sync metadata
- Expo:
  - Fix memory leak in certain cases (needs repro info)
- Devtools
  - Fix: When resetting the database but keeping the eventlog
    - on next app start, the app doesn't re-hydrate properly (somehow seems to "double hydrate")
  - support app reloading in Expo (requires an equivalent of `beforeunload` to be triggered in `makeClientSession`)
  - sync session appears for wrong storeid (needs repro info)
  - sync view:
    - different colors for when a node pulled/pushed
    - show status indicators in each node: uptodate/syncing/error
      - syncing should include the number of events still pending to push/pull
      - maybe we can also figure out how to get the sync backend status?
  - mutations explorer:
    - show client events as tree
    - always show root event s0
- Release
  - Write blog post
  - Prepare X/Bluesky thread

### After release:
- Get rid of `sql-queries` module
- Get rid of `queryDb` by exposing live queries directly on the query builder / state primitives
- Bring back rehydrating via in-memory database (requires both app and mutation db to be in-memory)
- Handle more gracefully: 2 different store instances with the same store id currently dead-lock on boot (probably related to semaphore in LiveStoreProvider)
- Web adapter:
  - Refactor `shared-worker`
    - Make it optional (for Android support)
    - Make it store-agnostic (so it's reused across store instances)
    - Remove extra broadcast channel for session info in @livestore/adapter-web
- Improve sync testing (prop testing): introduce arbitrary latency for any kind of async step (~ chaos testing)
- Examples:
  - setup: for todomvc, have a shared source of truth for the livestore definitions and have some scripts which copy them to the various example apps
  - add some docs/comments to the mutations / schema definitions + link to mutation best practices (+ mention of AI linting)
- Docs
  - Notes on deployment (when to deploy what)
  - Embrace term "containers"
    - Unit of sharing/collaboration/auth
    - What if I want got my initial container design wrong and I want to change it?
      - Comparables: document databases, kafka streams, 


## 0.2.0

### Core

- Added query builder API
  
  ```ts
  const table = DbSchema.table('myTable', {
    id: DbSchema.text({ primaryKey: true }),
    name: DbSchema.text(),
  })

  table.query.select('name')
  table.query.where('name', '==', 'Alice')
  table.query.where({ name: 'Alice' })
  table.query.orderBy('name', 'desc').offset(10).limit(10)
  table.query.count().where('name', 'like', '%Ali%')
  table.get('123', { insertValues: { name: 'Bob' } })
  ```

- Breaking: Renamed `querySQL` to `queryDb` and adjusted the signature to allow both the new query builder API and raw SQL queries:
  ```ts
   // before
   const query$ = querySQL(sql`select * from myTable where name = 'Alice'`, {
    schema: Schema.Array(table.schema),
  })

  // after (raw SQL)
   const query$ = queryDb({
    query: sql`select * from myTable where name = 'Alice'`,
    schema: Schema.Array(table.schema),
  })

  // or with the query builder API
  const query$ = queryDb(table.query.select('name').where({ name: 'Alice' }))
  ```

- Breaking: Replaced `rowQuery()` with `table.get()` (as part of the new query builder API)

### React integration

- Fix: `useClientDocument` now type-safe for non-nullable/non-default columns. Renamed `options.defaultValues` to `options.insertValues`

### Misc

- Removed Drizzle example in favour of new query builder API
- Removed `livestore/examples` repository in favour of `/examples/standalone` (additionally `/examples/src` for maintainers)

## 0.1.0

### Core

- Breaking: Updated storage format version to 2 (will create new database files)

- Breaking: Changed `schema.key` to `storeId` [#175](https://github.com/livestorejs/livestore/issues/175)
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

- Breaking: Removed `useLocalId` / `getLocalId` in favour of `store.sessionId` / `SessionIdSymbol`
- Upgraded dependencies
  - If you're using `effect` in your project, make sure to install version `3.10.x`
    - Note the new version of `effect` now includes `Schema` directly, so `@effect/schema` is no longer needed as a separate dependency. (See [Effect blog post](https://effect.website/blog/releases/effect/310/#effectschema-moved-to-effectschema).)

- Breaking: Moved `effect-db-schema` to `@livestore/db-schema` (mostly an internal change unless you're using the package directly)

- Breaking: Adjusted `boot` signature when creating a store to now pass in a `Store` instead of a helper database object
  ```tsx
  <LiveStoreProvider
    schema={schema}
    boot={(store) => store.mutate(mutations.todoCreated({ id: nanoid(), text: 'Make coffee' }))}
    adapter={adapter}
    batchUpdates={batchUpdates}
  >
    // ...
  </LiveStoreProvider>
  ```

- Prepared the foundations for the upcoming [rebase sync protocol](https://github.com/livestorejs/livestore/issues/195)
  - Implementation detail: New event id strategy (uses a global event id integer sequence number and each event also keeps a reference to its parent event id)

### React integration

- Breaking: The React integration has been moved into a new separate package: `@livestore/react` (before: `@livestore/livestore/react`)

- Breaking: Renamed `useTemporaryQuery` to `useScopedQuery`

### Web adapter

- Devtools address is now automatically logged during development making connecting easier.
  ![](https://i.imgur.com/nmkS9yR.png)

- Breaking: Changed syncing adapter interface:

  ```ts
  const adapter = makePersistedAdapter({
    storage: { type: 'opfs' },
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
    syncBackend: {
      type: 'cf',
      url: import.meta.env.VITE_LIVESTORE_SYNC_URL,
      roomId: `todomvc_${appId}`,
    },
  })
  ```

### Expo adapter

- Updated to Expo SDK 52 (`52.0.0-preview.23`)

- Fix: Crash in release builds [#206](https://github.com/livestorejs/livestore/issues/206)

- Fix: Disable devtools in release builds [#205](https://github.com/livestorejs/livestore/issues/205)

### Devtools

- Feature: New SQLite query playground
  ![](https://i.imgur.com/99zq6vk.png)

- Fix: Databrowser no longer crashes when removing tables [#189](https://github.com/livestorejs/livestore/issues/189)

- Breaking (in combination with web adapter): Removed `_devtools.html` in favour of `@livestore/devtools-vite`. [#192](https://github.com/livestorejs/livestore/issues/192)
  - Replace `@livestore/devtools-react` with `@livestore/devtools-vite` in your `package.json`
  - Delete `_devtools.html` if it exists
  - Add the following to your `vite.config.ts`:

    ```ts
    import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

    export default defineConfig({
      // ...
      plugins: [
        // ...
        livestoreDevtoolsPlugin({ schemaPath: './src/db/schema/index.ts' }),
        // ...
      ],
    })
    ```
### Misc

- Improved CI setup [#179](https://github.com/livestorejs/livestore/issues/179) [#166](https://github.com/livestorejs/livestore/issues/166)
