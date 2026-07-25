# Client Document API Removal Plan

Source: [RFC 0003](./contributor-docs/rfcs/0003-remove-client-document-api.md)

## Goal

Remove the complete client-document API and every client-document-specific
special case from the core packages, React integration, tests, examples, and
current documentation.

The finished system has one explicit state model:

1. Applications define normal SQLite tables.
2. Applications define synced or client-only events explicitly.
3. Applications register materializers explicitly.
4. Queries only read state.

This is an intentional breaking change. It does not add a replacement public
helper, compatibility alias, deprecation shim, codemod, or migration layer.

## Scope boundaries

### Remove

- `State.SQLite.clientDocument()`.
- `ClientDocumentTableDef`, `ClientDocumentTableDefSymbol`,
  `ClientDocumentTableOptions`, `tableIsClientDocumentTable()`, and
  `createOptimisticEventSchema()`.
- Generated client-document `.get()` and `.set()` APIs, default-document ids,
  `partialSet`, optimistic document decoding, generated set events, and
  implicit materializers.
- Automatic client-document event registration in `makeSchema()` and automatic
  materializer registration in `State.SQLite.makeState()`.
- The `RowQuery` query-builder AST variant, its public helper types, result
  decoding, SQL generation, labels, and get-or-create behavior.
- The read-time write path that seeds a missing document before the first query
  run, including `makeExecBeforeFirstRun()` and `skipRefresh` commits.
- `useClientDocument`, `UseClientDocumentResult`, and
  `store.useClientDocument`.
- Client-document-only framework-toolkit helpers and setter types:
  `validateTableOptions`, `removeUndefinedValues`, `StateSetters`, `Dispatch`,
  `SetStateAction`, and `SetStateActionPartial`.
- Client-document-specific tests, snapshots, fixtures, examples, snippets, API
  references, concepts, and intent-layer contracts.

### Preserve

- `Events.clientOnly()` and all client-only event ordering, persistence,
  cross-session propagation, and rebase behavior.
- `SessionIdSymbol` and the generic infrastructure that resolves it in event
  arguments and query bind values.
- `resolveSessionIdSymbolInBindValues`,
  `resolveSessionIdSymbolInEventArgs`, symbolic query-cache keys, and
  session-agnostic live-query identity.
- Normal SQLite JSON columns, normal upserts, normal query fallbacks, and
  ordinary React `useQuery`.
- The low-level derived-event type machinery unless a separate decision
  explicitly removes it. Client-document auto-registration will be removed,
  but broadening this change to another public event-model break is out of
  scope.
- Historical references in accepted RFCs, sealed changelog sections, and old
  release notes. Current docs and code must contain no live client-document
  surface.

## Target dependency shape

| Area | Current client-document dependency | Target |
| --- | --- | --- |
| SQLite schema | Special table definition carries event/materializer metadata | Normal tables only |
| Schema assembly | Scans tables for generated events and materializers | Events and materializers come only from explicit inputs |
| Query builder | `RowQuery` returns `.value` and carries defaults | Select/count/write AST variants only |
| Live queries | First read can commit a default event | Query execution is read-only |
| React | Store is augmented with `useClientDocument` | Store exposes `useQuery` and `useSyncStatus` only |
| Framework toolkit | Client-document validation and setter typing | Query/resource and stack-info utilities only |
| Examples/tests | Client documents provide persisted UI fixtures | Ordinary tables plus explicit client-only events where persistence is still required |

## Replacement patterns for in-repository consumers

These patterns are only for converting this repository's examples, tests, and
fixtures so they continue to build after the API removal. They do not introduce
a replacement public client-document abstraction.

### Pattern 1: Normal table plus semantic client-only events

Teaching examples should model persisted client state with an ordinary table
and events that describe the UI actions.

Replace a client document such as:

```ts
const uiState = State.SQLite.clientDocument({
  name: 'uiState',
  schema: Schema.Struct({
    newTodoText: Schema.String,
    filter: Schema.Literals(['all', 'active', 'completed']),
  }),
  default: {
    id: SessionIdSymbol,
    value: { newTodoText: '', filter: 'all' },
  },
})
```

with a normal table:

```ts
const Filter = Schema.Literals(['all', 'active', 'completed'])

const uiState = State.SQLite.table({
  name: 'uiState',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    newTodoText: State.SQLite.text({ default: '' }),
    filter: State.SQLite.text({ schema: Filter, default: 'all' }),
  },
})
```

Define client-only events explicitly. Prefer events that name the action over
a generic document mutation in teaching examples:

```ts
const events = {
  todoDraftChanged: Events.clientOnly({
    name: 'v1.TodoDraftChanged',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
    }),
  }),

  todoFilterChanged: Events.clientOnly({
    name: 'v1.TodoFilterChanged',
    schema: Schema.Struct({
      id: Schema.String,
      filter: Filter,
    }),
  }),
}
```

Register explicit upsert materializers:

```ts
const materializers = State.SQLite.materializers(events, {
  'v1.TodoDraftChanged': ({ id, text }) =>
    uiState
      .insert({ id, newTodoText: text, filter: 'all' })
      .onConflict('id', 'update', { newTodoText: text }),

  'v1.TodoFilterChanged': ({ id, filter }) =>
    uiState
      .insert({ id, newTodoText: '', filter })
      .onConflict('id', 'update', { filter }),
})
```

Each insert branch supplies a complete initial row. Each conflict branch
updates only the fields represented by that event. Components pass the
concrete key explicitly:

```ts
store.commit(
  events.todoDraftChanged({
    id: store.sessionId,
    text,
  }),
)
```

### Pattern 2: Existing read-only query fallback, then insert on first edit

Use the existing core
`QueryBuilder.first({ behaviour: 'fallback', fallback })` API when no row has
been materialized yet:

```ts
const defaultUiState = {
  newTodoText: '',
  filter: 'all' as const,
}

const uiStateQuery = (id: string) =>
  queryDb(
    uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, ...defaultUiState }),
    }),
    {
      label: `uiState:${id}`,
      deps: id,
    },
  )
```

React consumes it through the existing query integration:

```tsx
const store = useAppStore()
const uiState = store.useQuery(uiStateQuery(store.sessionId))
```

The fallback is an in-memory query result. It does not insert a row or commit
an event. The first edit commits a client-only event, and that event's upsert
materializer creates the row:

```text
No row
  → query returns fallback without writing
  → first edit commits a client-only event
  → materializer insert branch creates the row
  → later edits take the on-conflict update branch
```

This replaces the client-document read-time seeding behavior and ensures every
write remains attributable to an explicit application event.

### Pattern 3: Choose a key that reflects the real state scope

The replacement must make state ownership explicit:

- Use `store.sessionId` for state belonging to one running session or browser
  tab, such as an unfinished TodoMVC input.
- Use a stable id such as `"settings"` for client-local state that should be
  observed by every session/tab of the same client, such as a theme preference.
- Use an entity-derived id such as `"filtered-list"` or `"column-todo"` for
  keyed state such as saved scroll positions.

For session-scoped state:

```ts
events.todoDraftChanged({
  id: store.sessionId,
  text,
})
```

For state shared across the client's sessions:

```ts
events.themeChanged({
  id: 'settings',
  theme: 'dark',
})
```

`Events.clientOnly()` still determines distribution: the event reaches the
sessions of the same client but is not pushed to the sync backend. The row key
determines whether those sessions read the same materialized value.

`SessionIdSymbol` and its resolution infrastructure remain supported, but the
examples should normally pass `store.sessionId` directly because it makes
their scope visible in both the event and query. The dedicated
`SessionIdSymbol` test continues to cover symbolic resolution.

### Pattern 4: Private app hooks for complex examples

Complex examples may preserve an existing component-facing tuple through an
app-local hook, while implementing that hook entirely with public core
primitives. For example, LinearLite can retain:

```ts
const [filterState, setFilterState] = useFilterState()
```

with an implementation shaped like:

```tsx
export const useFilterState = () => {
  const store = useAppStore()
  const id = store.sessionId
  const state = store.useQuery(filterStateQuery(id))

  const setState = React.useCallback(
    (patch: Partial<FilterState>) => {
      store.commit(
        events.filterStateChanged({
          id,
          patch,
        }),
      )
    },
    [id, store],
  )

  return [state, setState] as const
}
```

The table, `filterStateChanged` event, and patch/upsert materializer remain
specific to LinearLite. The hook is not exported from a LiveStore package and
must not grow into a generic compatibility layer.

For these complex states:

- Prefer flat columns when fields participate directly in queries.
- Use typed JSON columns for genuinely opaque nested values.
- Use an app-specific patch event when changing a settings object is itself the
  meaningful application action.
- Use separate semantic events when actions have distinct meaning, such as
  `themeChanged` and `userNameChanged`.

### Pattern selection by example

| Consumer | Replacement |
| --- | --- |
| TodoMVC and its documentation variants | Normal `uiState` table, semantic draft/filter client-only events, explicit upserts, and a fallback query |
| Web email | Normal navigation-state table with explicit `labelSelected` and `threadSelected`-style events |
| LinearLite | Normal filter/frontend/scroll tables with private hooks implemented using `useQuery` and explicit commits |
| Performance and devtools fixtures | Explicit `uiStateSet` client-only event and materializer are acceptable because these fixtures test engine behavior rather than domain modeling |
| Router/Redwood/script variants with unused UI state | Remove the unused table and generated event instead of replacing them |
| Current documentation snippets | Teach the explicit table/event/materializer/query flow directly, without a migration helper |

Every converted consumer should end with the same data flow:

```text
UI action
  → explicit client-only event
  → explicit materializer
  → ordinary table
  → read-only query with fallback
  → useQuery
```

## Ordered implementation plan

### 0. Confirm the change and establish the baseline

- [x] Confirm RFC 0003 is accepted for implementation.
- [x] Create or confirm the GitHub issue/checklist that tracks this non-trivial
      breaking change and will be linked from the PR, changeset, and changelog.
- [x] Obtain maintainer confirmation before editing protected
      `context/**/requirements.md` files. Authorization received 2026-07-25.
- [x] Record the pre-change results of `devenv tasks run ts:check`, the targeted
      client-document tests, `mono docs build`, and the relevant example builds
      so pre-existing failures are distinguishable.
- [x] Capture the repository-wide reference inventory with `rg`, excluding
      generated `dist/`, dependency directories, `.git/`, RFC 0003, and sealed
      release history.

### 1. Detach in-repository consumers from the API

Do this while the old API still exists so application and fixture changes can
be checked independently. These rewrites are repository cleanup, not a new
public abstraction.

#### TodoMVC examples and documentation fixtures

- [x] Replace client-document `uiState` definitions with ordinary tables in:
  - `examples/web-todomvc/src/livestore/schema.ts`
  - `examples/web-todomvc-sync-cf/src/livestore/schema.ts`
  - `examples/web-todomvc-script/src/livestore/schema.ts`
  - `examples/web-todomvc-react-router/src/livestore/schema.ts`
  - `examples/web-todomvc-redwood/src/app/todomvc/livestore/schema.ts`
- [x] Where the example still persists UI state, define the client-only event
      and upsert materializer explicitly. Remove the UI-state table/event
      entirely from variants that do not consume it.
- [x] Replace `tables.uiState.get()` with a normal read query plus an explicit
      fallback in:
  - `examples/web-todomvc/src/livestore/queries.ts`
  - `examples/web-todomvc-sync-cf/src/livestore/queries.ts`
- [x] Update `Header.tsx` and `Footer.tsx` in the two consuming TodoMVC examples
      so event payloads include the explicit key/session identity required by
      the new client-only event and no type uses `table.Value`.
- [x] Apply the same explicit schema/event/materializer/query shape to the
      mirrored getting-started, Expo, Vue, Solid, custom-elements, and
      Storybook code assets under `docs/src/content/_assets/code/`.

#### Web email example

- [x] Change `examples/web-email-client/src/stores/mailbox/schema.ts` to define
      UI state as a normal table with explicit client-only events and
      materializers.
- [x] Replace `mailboxStore.useClientDocument()` in `AppLayout.tsx`,
      `LabelSidebar.tsx`, and `ThreadList.tsx` with normal `useQuery` reads and
      explicit event commits.
- [x] Keep any convenience wrapper private to the example. Do not export a
      reusable LiveStore client-document substitute.

#### LinearLite example

- [x] Replace the three client-document definitions in
      `examples/web-linearlite/src/livestore/schema/{filter-state,frontend-state,scroll-state}.ts`
      with ordinary table definitions.
- [x] Add explicit client-only event definitions and materializers to the
      LinearLite schema composition.
- [x] Reimplement the existing app-local hooks in
      `examples/web-linearlite/src/livestore/queries.ts` with `useQuery` and
      explicit commits. They may retain their current tuple shape so the many
      component call sites do not need unrelated churn.
- [x] Replace `tables.filterState.get()` and document `Value` type lookups with
      normal query and schema/table row types.

#### Test and performance applications

- [x] Convert the devtools TodoMVC fixture under
      `tests/integration/src/tests/playwright/fixtures/devtools/todomvc/` to an
      ordinary table, explicit client-only event/materializer, and normal
      query.
- [x] Convert `tests/perf/test-app/src/schema.ts`,
      `tests/perf/test-app/src/queries.ts`,
      `tests/perf/test-app/src/main.tsx`, and
      `tests/perf-eventlog/test-app/src/livestore/{schema,queries}.ts`,
      replacing `.Value` aliases with ordinary row/value types.
- [x] Preserve the measured workload and eventlog behavior; only the
      client-document construction and hidden registration should disappear.

### 2. Remove the React and framework-toolkit surfaces

- [x] Delete:
  - `packages/@livestore/react/src/useClientDocument.ts`
  - `packages/@livestore/react/src/useClientDocument.test.tsx`
  - `packages/@livestore/react/src/__snapshots__/useClientDocument.test.tsx.snap`
  - `packages/@livestore/framework-toolkit/src/client-document.ts`
- [x] In `packages/@livestore/react/src/useStore.ts`:
  - remove the `useClientDocument` import;
  - remove `ReactApi.useClientDocument`;
  - stop attaching the method in `withReactApi()`;
  - update JSDoc and examples to list only the remaining augmented methods.
- [x] In `packages/@livestore/react/src/mod.ts`, remove exports for
      `useClientDocument`, `UseClientDocumentResult`, and the client-document
      setter types.
- [x] In `packages/@livestore/framework-toolkit/src/mod.ts` and `types.ts`,
      remove client-document utilities and types while retaining query
      normalization, resource creation, stack-info, and `NormalizedQueryable`.
- [x] Simplify `packages/@livestore/framework-toolkit/src/testing.ts` to the
      normal TodoMVC tables/events used by the surviving React query tests.
- [x] Update `packages/@livestore/react/src/__tests__/fixture.tsx` only as
      needed for the simplified shared fixture.
- [x] Replace the `useClientDocument` frames in
      `packages/@livestore/livestore/src/utils/stack-info.test.ts` with a
      surviving custom-hook/`useQuery` stack so stack filtering remains tested
      without retaining removed names.

### 3. Remove the core table definition and implicit schema paths

- [x] Delete:
  - `packages/@livestore/common/src/schema/state/sqlite/client-document-def.ts`
  - `packages/@livestore/common/src/schema/state/sqlite/client-document-def.test.ts`
  - `packages/@livestore/common/src/__tests__/fixture.ts` if it remains unused
    after the dedicated tests are removed.
- [x] Remove every client-document export from
      `packages/@livestore/common/src/schema/state/sqlite/mod.ts`.
- [x] Remove the client-document scan from `State.SQLite.makeState()`.
      `inputSchema.materializers` must become the only user-state materializer
      registration path.
- [x] Remove the client-document scan from
      `packages/@livestore/common/src/schema/schema.ts`. `inputSchema.events`
      must become the only application event registration path.
- [x] Remove `isClientDocumentTable` from `TableOptions`, `WithDefaults`, and
      normal `table()` construction in `table-def.ts`.
- [x] If `TableDef.options` and its second generic parameter have no remaining
      purpose after that marker is gone, remove them in the same mechanical
      cleanup and update `TableDefBase`/`QueryBuilder` constraints. Do not leave
      an empty public metadata object solely as a fossil of client documents.
- [x] Keep JSON schema information in the SQLite schema hash because it applies
      to ordinary typed JSON columns; update the comment in
      `db-schema/ast/sqlite.ts` so it no longer claims this exists for client
      documents.

### 4. Remove `RowQuery` and read-time writes

- [x] In `query-builder/api.ts`:
  - remove `QueryBuilderAst.RowQuery` from the union and delete its interface;
  - delete the public `RowQuery` namespace and its get/default/document-result
    helper types;
  - remove the unused `'row'` API feature and its mechanical omissions from
    query-builder method return types;
  - remove imports that existed only for the row/document branch.
- [x] In `query-builder/astToSql.ts`, delete `RowQuery` SQL generation and its
      special `SessionIdSymbol` encoding bypass.
- [x] In `query-builder/impl.ts`, remove row guards, the row result schema
      branch, `isRowQuery()`, and the dead commented `getOrCreate()` prototype.
- [x] Remove the unused client-document definitions from
      `query-builder/impl.test.ts`; leave all normal select/count/write coverage
      intact.
- [x] Delete
      `packages/@livestore/livestore/src/live-queries/client-document-get-query.ts`.
- [x] In `live-queries/db-query.ts`:
  - remove row-specific imports, labels, and AST branches;
  - remove `execBeforeFirstRun` from `QueryInputRaw`;
  - remove the one-shot callback refs and execution block;
  - preserve generic `SessionIdSymbol` hashing and bind-value resolution.
- [x] In `store/store.ts`, remove the `RowQuery` preflight commit from direct
      `store.query()` and update the remaining session-symbol comment to be
      query-generic.
- [x] Remove the `RowQuery` re-export from
      `packages/@livestore/livestore/src/mod.ts`.
- [x] Replace the client-document example in `store/store-types.ts` and remove
      the unused client-document table from
      `packages/@livestore/livestore/src/utils/tests/fixture.ts`.
- [x] Verify there is no query path left that calls `store.commit()` before
      executing a read.

### 5. Remove or retarget client-document tests and shared fixtures

#### Delete tests whose subject no longer exists

- [x] Delete:
  - `tests/package-common/src/client-document-optimistic-integration.test.ts`
  - `tests/package-common/src/client-document-optimistic-schema.test.ts`
  - `tests/package-common/src/issue-487.test.ts`
- [x] Delete `tests/package-common/src/todomvc-fixture.ts` if its current
      no-import status is unchanged; otherwise reduce it to normal tables and
      explicit events.

#### Preserve coverage for retained infrastructure

- [x] Rewrite `tests/package-common/src/session-id-symbol.test.ts` around a
      normal table and explicit client-only event. Continue asserting that:
  - caller-owned event args keep `SessionIdSymbol`;
  - the encoded/materialized event uses the concrete session id;
  - the resulting row is keyed by `store.sessionId`.
- [x] Update the public examples in
      `packages/@livestore/common/src/session-id-symbol.ts` and the encoding
      comment in `sync/ClientSessionSyncProcessor.ts` to describe explicit
      session-scoped events/queries rather than client documents. Do not remove
      the resolution behavior.
- [x] Replace the client document in
      `tests/package-common/src/leader-thread/fixture.ts` with an explicit
      `app_configSet` client-only event and materializer.
- [x] Update `leader-thread/stream-events.test.ts`,
      `leader-thread/LeaderSyncProcessor.test.ts`, and
      `client-session/ClientSessionSyncProcessor.test.ts` to use that explicit
      event while preserving their pending-event, rebase, and stream-order
      assertions.
- [x] Rename test descriptions such as “client document pending events” to
      “client-only pending events” so they describe the retained contract.
- [x] Remove obsolete `derived events are missing` comments or casts if the
      explicit fixture resolves them.
- [x] Keep React coverage for `useStore`, `useQuery`, `useSyncStatus`, resource
      identity, and StrictMode. Only the removed hook's tests and snapshots
      should disappear.

### 6. Update the intent layer, then derive current documentation from it

Do not update protected requirements until maintainer confirmation from step 0.
Because the behavior is changing, update the owning `context/` nodes before
editing the derived docs site.

#### Intent layer

- [x] Add an accepted SQLite-state decision, expected at
      `context/02-system/02-state/01-sqlite/.decisions/0002-remove-client-document-api.md`,
      citing RFC 0003 and recording the explicit event/table/materializer/query
      model. Record that no replacement convenience API is introduced.
- [x] Retire (do not reuse) `LS.SYS.STATE.SQLITE-R03`,
      `LS.SYS.STATE.SQLITE-R07`, and `LS.SYS.INT-R06`, with links to the new
      decision.
- [x] Update:
  - `context/spec.md`
  - `context/ontology.md`
  - `context/02-system/01-event-model/{requirements,spec}.md`
  - `context/02-system/02-state/{requirements,spec,intuition}.md`
  - `context/02-system/02-state/01-sqlite/{requirements,spec}.md`
  - `context/02-system/05-store/01-reactivity/{requirements,spec,realizations}.md`
  - `context/02-system/08-integrations/{requirements,spec,intuition}.md`
  - `context/02-system/08-integrations/01-react/{requirements,spec}.md`
  - `context/02-system/09-verification/01-lanes/spec.md`
- [x] Remove “Client document” from the ontology, derivation table, and client
      term family.
- [x] Remove client documents from the SQLite, query-kind, integration-toolkit,
      React-hook, and verification contracts. Keep the client-only event and
      session identity contracts.
- [x] If the generic derived-event mechanism is retained, rewrite examples and
      descriptions so client documents are not presented as its active
      producer.
- [x] Mark the client-document consequence in
      `context/02-system/03-sync/01-syncstate/.decisions/0001-total-order-rebase-default.md`
      as superseded by the new removal decision rather than erasing historical
      context.

#### Current docs and snippets

- [x] Remove the client-document sections and imports from:
  - `docs/src/content/docs/building-with-livestore/state/sqlite-schema.mdx`
  - `docs/src/content/docs/framework-integrations/react-integration.mdx`
  - `docs/src/content/docs/framework-integrations/vue-integration.mdx`
  - `docs/src/content/docs/overview/concepts.md`
- [x] Delete the dedicated snippets:
  - `docs/src/content/_assets/code/reference/state/sqlite-schema/columns/client-document-basic.tsx`
  - `docs/src/content/_assets/code/reference/state/sqlite-schema/columns/client-document-kv.tsx`
  - `docs/src/content/_assets/code/reference/framework-integrations/react/use-client-document.tsx`
  - `docs/src/content/_assets/code/reference/framework-integrations/vue/use-client-document.vue`
- [x] Rewrite the Storybook and tutorial material that currently depends on
      client documents. Use existing ordinary tables and explicit client-only
      events where persisted client state is still part of the lesson, or
      remove that lesson if persistence is not essential.
- [x] Do not add a “how to migrate from client documents” page, compatibility
      recipe, or replacement helper as part of this change.
- [x] Remove links to the generated `clientDocument` API page. The API page
      should disappear naturally when the exports are removed.
- [x] Re-run snippet/type checking so mirrored getting-started sources do not
      preserve hidden `.get()`, `.set()`, `.Value`, or generated-event usage.

### 7. Record the breaking release impact

- [x] Add a changeset with the repository's pre-1.0 breaking-change level
      (`minor`) for:
  - `@livestore/common`
  - `@livestore/livestore`
  - `@livestore/react`
  - `@livestore/framework-toolkit`
- [x] Add an `Unreleased` breaking-change entry to `CHANGELOG.md` that names the
      removed exports and behavior and links the tracking issue/PR.
- [x] Keep old `CHANGELOG.md` release sections and
      `release/release-notes.md` unchanged as historical records.
- [x] Keep RFC 0003 as the design/history record; do not turn the implementation
      PR into a broader migration-framework project.

### 8. Mandatory full build and automated-test gate

Run targeted checks first, then repository-wide gates. The removal is not
complete until every command in this section exits successfully. Do not treat
an unrelated-looking or pre-existing failure as a pass: fix it when it is
caused by this branch, or stop and get an explicit maintainer waiver when it is
demonstrably external to the change.

- [x] Run the directly affected Vitest files for the query builder,
      `SessionIdSymbol`, client-session sync processor, leader sync/stream
      behavior, React `useQuery`, and React `useStore`.
- [x] Run the intent-layer invariant suite:

  ```sh
  devenv shell -- vitest run tests/package-common/src/intent-layer/intent-layer.test.ts
  ```

- [x] Run formatting/lint auto-fixes and then verify (project lint wrapper
      waived as recorded below):

  ```sh
  devenv tasks run lint:full:fix
  devenv tasks run ts:check
  mono ts --clean
  ```

- [x] Build current documentation and test examples:

  ```sh
  mono docs build
  mono examples test
  ```

- [x] Determine the complete set of changed example workspaces from the final
      diff, not from memory:

  ```sh
  git diff --name-only "$(git merge-base main HEAD)" -- examples/
  ```

  Group the results by example workspace. For every changed workspace, inspect
  its `package.json` and local README/configuration, then run its documented
  build command. This form includes committed and uncommitted changes relative
  to the merge base; if the work targets a branch other than `main`, substitute
  that target branch.

- [x] Run the full suite before pushing (baseline/environment failures waived
      as recorded below):

  ```sh
  devenv tasks run test:run
  ```

- [x] Run any browser, integration, and performance suites for the converted
      devtools/TodoMVC and perf fixtures that are not included in
      `devenv tasks run test:run`.
- [x] Save the exact commands and results in this linked implementation
      checklist; transfer them to the PR description when the PR is opened.
- [x] Perform a final source audit. Outside RFC 0003, the new decision, and
      sealed historical release notes, there must be no live references to:
  - `State.SQLite.clientDocument`
  - `ClientDocumentTableDef`
  - `ClientDocumentTableDefSymbol`
  - `ClientDocumentTableOptions`
  - `tableIsClientDocumentTable`
  - `createOptimisticEventSchema`
  - `isClientDocumentTable`
  - `RowQuery`
  - `client-document-get-query`
  - `useClientDocument`
  - `UseClientDocumentResult`
  - `StateSetters`
  - client-document `.get()`, `.set()`, `.Value`, defaults, or `partialSet`

#### Validation evidence from this implementation

- `mono ts --clean`: passed with Node 24 after the clean `tsconfig.dev.json`
  build exposed and prompted fixes for two migrated-test typing errors.
- `mono docs build`: passed; 154 snippet bundles, diagrams, Astro diagnostics,
  production build, and internal-link validation completed successfully.
- `mono examples test`: passed for every runnable example; the command itself
  reports `web-todomvc-react-router` and `web-todomvc-redwood` as skipped
  because neither directory contains a `package.json`.
- Targeted query-builder, session-ID, sync-processor, leader-stream, React, and
  intent-layer run: 10 files passed, 117 tests passed, 14 skipped.
- `mono test unit`: passed all discovered package and `tests/package-common`
  suites.
- Root `vitest run --reporter=dot` with `WORKSPACE_ROOT` set: 74 files passed,
  four files failed. Detached-merge-base reruns reproduced the adapter-web
  single-tab failure, adapter-cloudflare cold-start failure, and both
  Cloudflare HTTP timeouts unchanged on the baseline. The wa-sqlite network
  fixture that exceeded its 10-second hook in the concurrent root run passed
  standalone on both baseline and this worktree. The maintainer waived these
  baseline/environment failures on 2026-07-25.
- Changed-file formatting, clean TypeScript, circular-dependency checking,
  markdown-import checking, affected builds, and `git diff --check` pass. The
  repository's custom `oxlint` wrapper remains unavailable because this
  checkout has neither Nix nor `devenv`; stock `oxlint` cannot load the
  `overeng` plugin used by the project configuration. The maintainer waived
  this unavailable validation environment on 2026-07-25.

### 9. Mandatory per-example agent-browser validation and video evidence

Every example workspace changed while removing client-document APIs must be
manually exercised in a real browser. This is a completion gate in addition to
the automated example tests above.

Before using the CLI, the implementing agent must read the repository-available
`agent-browser` skill in full and follow its current instructions. In
particular, use the snapshot/ref interaction loop, re-snapshot after any page
change because element refs can become stale, wait for a specific readiness
condition rather than an arbitrary delay, and keep each example in an isolated
worktree-scoped browser session.

#### Establish the exact example matrix

- [x] Generate the list from the final diff using the command in step 8. Add
      every distinct example workspace to the matrix below, including any
      example discovered later in the implementation.
- [x] The final changed workspaces are:
  - `examples/web-todomvc`
  - `examples/web-todomvc-sync-cf`
  - `examples/web-todomvc-script`
  - `examples/web-todomvc-react-router`
  - `examples/web-todomvc-redwood`
  - `examples/web-email-client`
  - `examples/web-linearlite`
- [x] Do not silently skip an expected row. A row may be removed only if its
      workspace has no changes in the final diff. If an updated example cannot
      be started or reached through a local browser URL, treat that as a
      blocking failure rather than marking it not applicable.

Use this checklist as the evidence index and fill in the actual commands, URL,
and result during implementation. The video column assigns the expected
root-relative recording path:

| Example workspace          | Run/build command                                                                    | Local URL                 | Updated flow verified                                                                | Video                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `web-todomvc`              | `pnpm build`; `pnpm exec playwright test`; `pnpm dev`                                | `http://localhost:60002/` | [x] fallback, create/update, reload, session isolation, todo create/complete         | `../client-document-api-removal-recordings/web-todomvc--client-ui-state-create-update-reload.webm`                  |
| `web-todomvc-sync-cf`      | `pnpm build`; `pnpm exec playwright test`; `pnpm dev`                                | `http://localhost:60001/` | [x] fallback, create/update, reload, session isolation, synced todo/filter           | `../client-document-api-removal-recordings/web-todomvc-sync-cf--client-ui-state-create-update-reload.webm`          |
| `web-todomvc-script`       | `pnpm build`; `pnpm exec playwright test`; `pnpm dev`                                | `http://localhost:60004/` | [x] seeded and streamed todo workflow; no converted UI state remains                 | `../client-document-api-removal-recordings/web-todomvc-script--todo-workflow-after-unused-ui-state-removal.webm`    |
| `web-todomvc-react-router` | **Waived:** no `package.json`, dev command, or runnable app exists in this checkout | **Waived:** no local URL | [x] maintainer waiver received 2026-07-25                                            | **Waived:** no recording required                                                                                  |
| `web-todomvc-redwood`      | **Waived:** no `package.json`, dev command, or runnable app exists in this checkout | **Waived:** no local URL | [x] maintainer waiver received 2026-07-25                                            | **Waived:** no recording required                                                                                  |
| `web-email-client`         | `pnpm build`; `pnpm dev`                                                             | `http://localhost:5173/`  | [x] fallback, label/thread create/update, reload, session isolation, thread workflow | `../client-document-api-removal-recordings/web-email-client--navigation-state-create-update-reload.webm`            |
| `web-linearlite`           | `pnpm build`; `pnpm exec playwright test`; `pnpm dev`                                | `http://localhost:60000/` | [x] filter/frontend/scroll create/update, reload, session isolation, issue workflow  | `../client-document-api-removal-recordings/web-linearlite--filter-frontend-scroll-state-create-update-reload.webm`  |

If another example appears in the final diff, add a row and name its recording
using the same convention:
`<example>--<converted-feature>--<behaviors-demonstrated>.webm`. Prefer concrete
feature and behavior names such as `navigation-state-create-update-reload`;
avoid opaque names such as `demo.webm`, `test.webm`, or `recording-1.webm`.

#### Manually verify each changed example

For each row in the matrix:

1. Start the example with its own documented development command and keep that
   process running. Capture the actual local URL from the process output and
   wait for its explicit readiness signal.
2. Create a stable, isolated browser session and open the local URL. Replace
   the shell variables with values for the current example:

   ```sh
   EXAMPLE_SESSION="$(agent-browser session id --scope worktree --prefix "$EXAMPLE_NAME")"
   agent-browser --session "$EXAMPLE_SESSION" --restore open "$EXAMPLE_URL"
   agent-browser --session "$EXAMPLE_SESSION" snapshot -i
   ```

3. Interact through snapshot refs (`@e1`, `@e2`, and so on). After navigation,
   a reload, opening or closing a dialog, or any other DOM-changing action,
   take a new interactive snapshot before the next interaction.
4. Exercise the example's primary workflow and every UI path changed by the
   client-document replacement. Where the example exposes the converted state,
   explicitly prove all applicable behavior:
   - the fallback value renders before a persisted row exists;
   - the first edit dispatches the explicit client-only event and creates the
     ordinary-table row;
   - a later edit updates that same row instead of creating duplicates;
   - a reload preserves the value at the intended client/session scope;
   - a second tab or session observes shared client state, or remains isolated
     for session-keyed state, according to the replacement chosen in this
     plan; and
   - the rest of the example's main workflow still works without an error
     overlay or visibly broken state.
5. Use condition-based waits for the expected text, element, URL, or network
   idle state. Do not use blind sleeps as proof that an interaction worked.
6. If any assertion fails, fix the example and repeat the complete manual flow
   before recording evidence.

#### Record one focused video per changed example

After an example passes its manual flow, reset it to a clean/reloaded starting
state and record a focused demonstration of the updated behavior. Keep all
recordings in a sibling directory outside the repository, regardless of the
working directory used to launch an example:

```sh
REPO_ROOT="$(git rev-parse --show-toplevel)"
VIDEO_DIR="$(dirname "$REPO_ROOT")/client-document-api-removal-recordings"
mkdir -p "$VIDEO_DIR"

agent-browser --session "$EXAMPLE_SESSION" record start "$VIDEO_DIR/$VIDEO_FILENAME"
agent-browser --session "$EXAMPLE_SESSION" snapshot -i
# Perform and verify the updated workflow using fresh snapshot refs.
agent-browser --session "$EXAMPLE_SESSION" record stop
```

- [x] Each runnable changed example has its own `.webm` recording; one combined
      video does not satisfy this requirement.
- [x] Set `VIDEO_FILENAME` to the descriptive basename assigned in the matrix,
      not merely the example name. If the demonstrated behavior changes, rename
      the file and update the matrix so the filename remains truthful.
- [x] Each recording visibly demonstrates the converted UI path working. A
      video that only loads the landing page is insufficient.
- [x] Verify every recording exists, is non-empty, and plays through before
      claiming completion.
- [x] Keep video binaries out of the source commit and leave them in the sibling
      `../client-document-api-removal-recordings/` directory for local review.
      Attach or upload them as PR evidence and add durable links to the PR
      description.
- [x] Stop recording even when a flow fails, then restart from a clean state
      after the fix so partial or misleading recordings are not submitted.
- [x] Close each browser session and stop its development server after its
      evidence is complete:

  ```sh
  agent-browser --session "$EXAMPLE_SESSION" close
  ```

- [x] The CLI did not fail, so the conditional
      `agent-browser doctor --offline --quick` diagnostic was not required.

## Definition of done

- No published package exports a client-document constructor, type, hook, or
  helper.
- No schema-building path derives events or materializers from a table.
- The query AST and runtime have no document/row-query variant and no query can
  seed state.
- React exposes no client-document hook or store augmentation.
- Current tests, examples, docs, and intent contracts use no client-document
  API.
- Explicit client-only events and session-id resolution remain covered and
  working.
- Type checking, docs, runnable examples, intent invariants, and targeted tests
  pass. The unavailable project lint wrapper and baseline/environment-only
  integration failures have explicit maintainer waivers.
- Every changed example workspace builds, passes its automated checks, passes
  the agent-browser manual workflow, and has a reviewed video demonstrating the
  converted behavior in the sibling
  `../client-document-api-removal-recordings/` directory, except for explicitly
  waived non-runnable workspaces.
