# Changelog

> NOTE: LiveStore is still in alpha and releases can include breaking changes. See [state of the project](https://preview.livestore.dev/reference/state-of-the-project/) for more info.
> LiveStore is following a semver-like release strategy where breaking changes are released in minor versions before the 1.0 release.

## 0.3.0

- Still todo:
  - Fix devtools for web + expo
  - Get rid of `makeNextMutationEventIdPair` + `validateAndUpdateLocalHead`
  - Sync queue
    - Refactor `MutationEventEncodedWithDeferred` to work better alongside `mutationEventSchemaEncodedAny`
    - Implement in client session
    - Refactor to state machine
      - Expose `state` as a subscription ref
    - Use synclog payload as sync items

- New: Node adapter (experimental)
  - Note: Currently uses the `@livestore/sqlite-wasm` build but the plan is to move to a native SQLite build in the future to improve performance and reduce bundle size.
  - Still lacks a few devtools-related flows (e.g. graceful import/reset)
- Improved syncing
  - `sync-cf` backend: More reliable websocket connection handling
  - Configurable initial sync semantics (skip or block with timeout)
- Improved [documentation](https://livestore.dev/) (still a lot of work to do here)
- Added `@livestore/sqlite-wasm` package which wraps `@livestore/wa-sqlite` and exposes web and Node.js compatible VFS implementations
- Breaking: Removed `store.__execute` from `Store`. Please use `store.mutate(rawSqlMutation({ sql }))` instead.
- Improve Otel tracing integration
- Fix: The query builder now correctly handles `IN` and `NOT IN` where operations
- Internal:
  - Node syncing integration tests
  - New devtools protocol via webmesh
    - Should improve reliability of devtools connection (particularly during app reloads)
  - Large refactoring to share more code between adapters
  - Embraced git-style push/pull semantics to sync mutations across the system
  - Upgrade to TypeScript 5.7
- Upgraded dependencies
  - `effect` (needs to be 3.12.0 or higher)
  - `@livestore/wa-sqlite` (needs to be 1.0.3-dev.4)

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
    boot={(store) => store.mutate(mutations.addTodo({ id: nanoid(), text: 'Make coffee' }))}
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
  const adapter = makeAdapter({
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