# Changelog

> NOTE: LiveStore is still in alpha and releases can include breaking changes. See [state of the project](https://preview.livestore.dev/reference/state-of-the-project/) for more info.
> LiveStore is following a semver-like release strategy where breaking changes are released in minor versions before the 1.0 release.

## 0.3.0

### New features

- New sync implementation (based on git-like push/pull semantics)
  - See [Syncing docs page](https://livestore.dev/reference/syncing/syncing/) for more details
  - `sync-cf` backend: More reliable websocket connection handling
  - Configurable sync semantics when app starts (either skip initial sync or block with timeout)

- New: Node adapter `@livestore/adapter-node` (experimental)
  - Note: Currently uses the `@livestore/sqlite-wasm` build but the plan is to move to a native SQLite build in the future to improve performance and reduce bundle size.
  - Still lacks a few devtools-related flows (e.g. graceful import/reset)

- New: `@livestore/sync-electric` backend (experimental)
  - See [docs page](https://livestore.dev/reference/syncing/electricsql/) for more details

- New: `@livestore/adapter-expo` now supports syncing:
  ```ts
  const adapter = makePersistedAdapter({
    sync: { makeBackend: ({ storeId }) => makeCfSync({ url: `...`, storeId }) },
  })
  ```

- New: Solid integration `@livestore/solid` (experimental)
  - Still very early stage and probably lacks some features. Feedback wanted!
  - Thank you to [@kulshekhar](https://github.com/kulshekhar) for the initial implementation! (See [PR #225](https://github.com/livestorejs/livestore/pull/225))
  - There are is still a lot of [work to be done](packages/@livestore/solid/README.md) - contributions welcome!

### Breaking changes

- Breaking: Renamed adapter packages:
  - `@livestore/web` now is `@livestore/adapter-web`
  - `@livestore/expo` now is `@livestore/adapter-expo`
- Breaking: Removed `@livestore/db-schema` package and moved to `@livestore/common/schema`
- Breaking: Renamed `store.mutate` to `store.commit`
  - Reason: Make it more clear that committing mutations is also syncing them across other clients

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
- Breaking `@livestore/react`: `useRow` now only works with for tables with client-only derived mutations.
- Breaking: Instead of calling `query$.run()` / `query$.runAndDestroy()`, please use `store.query(query$)` instead.
- Breaking: Removed `store.__execute` from `Store`. Please use `store.commit(rawSqlMutation({ sql }))` instead.
- Breaking: Removed `globalReactivityGraph` and explicit passing of `reactivityGraph` to queries.
- Breaking: Removed `persisted` option from `store.commit`. This will be superceded by [mutation log compaction](https://github.com/livestorejs/livestore/issues/136) in the future.
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
- Improved mutation log view:
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
  - `effect` (needs to be 3.13.12 or higher)
  - `@livestore/wa-sqlite` (needs to be 1.0.5-dev.2)

### Still todo:

- After release:
  - Bring back rehydrating via in-memory database (requires both app and mutation db to be in-memory)
  - chrome extension: Prevent service worker from going inactive (otherwise extension worker message channels will also go down)
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
- Fix linting
- Re-expose `Schema` from `@livestore/utils/effect`
- docs: `llms.txt`
- Separate mutation handler from mutation definition
- Syncing
  - Fix: mutation log unique constraint violation during concurrent mutations
  - cf sync:
    - use http for initial pull while WS connection is established
    - Adjust networking protocol to embrace a "walk" flow similar to how ElectricSQL's protocol works. i.e. instead of doing 1 pull-req and getting n pull-res back, we will adjust this to be 1:1 at the expense of slightly higher round tripping overhead
      - We will "downgrade" the purpose of the `remaining` field to be only used for UX purposes but not for correctness purposes. For correctness we will only stop pull-walking when we get an empty array back.
    - Bring back "broadcast" pull res terminology
  - Electric:
    - fix: connectivity state + offline handling
    - implement sync payload
  - Clients should detect and gracefully handle when a sync backend resets its mutation log (e.g. during debugging)
  - Remaining issues:
    - [#283](https://github.com/livestorejs/livestore/issues/283)
- Devtools
  - Fix: When resetting the database but keeping the eventlog
    - on next app start, the app doesn't re-hydrate properly (somehow seems to "double hydrate")
- Expo:
  - Fix: Implement proper SQLite rollback via session extension once landed in expo-sqlite
- Release
  - Write blog post
  - Prepare X/Bluesky thread


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
  table.query.row('123', { insertValues: { name: 'Bob' } })
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

- Breaking: Replaced `rowQuery()` with `table.query.row()` (as part of the new query builder API)

### React integration

- Fix: `useRow` now type-safe for non-nullable/non-default columns. Renamed `options.defaultValues` to `options.insertValues`

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