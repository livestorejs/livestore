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

- [ ] Confirm RFC 0003 is accepted for implementation.
- [ ] Create or confirm the GitHub issue/checklist that tracks this non-trivial
      breaking change and will be linked from the PR, changeset, and changelog.
- [ ] Obtain maintainer confirmation before editing protected
      `context/**/requirements.md` files.
- [ ] Record the pre-change results of `devenv tasks run ts:check`, the targeted
      client-document tests, `mono docs build`, and the relevant example builds
      so pre-existing failures are distinguishable.
- [ ] Capture the repository-wide reference inventory with `rg`, excluding
      generated `dist/`, dependency directories, `.git/`, RFC 0003, and sealed
      release history.

### 1. Detach in-repository consumers from the API

Do this while the old API still exists so application and fixture changes can
be checked independently. These rewrites are repository cleanup, not a new
public abstraction.

#### TodoMVC examples and documentation fixtures

- [ ] Replace client-document `uiState` definitions with ordinary tables in:
  - `examples/web-todomvc/src/livestore/schema.ts`
  - `examples/web-todomvc-sync-cf/src/livestore/schema.ts`
  - `examples/web-todomvc-script/src/livestore/schema.ts`
  - `examples/web-todomvc-react-router/src/livestore/schema.ts`
  - `examples/web-todomvc-redwood/src/app/todomvc/livestore/schema.ts`
- [ ] Where the example still persists UI state, define the client-only event
      and upsert materializer explicitly. Remove the UI-state table/event
      entirely from variants that do not consume it.
- [ ] Replace `tables.uiState.get()` with a normal read query plus an explicit
      fallback in:
  - `examples/web-todomvc/src/livestore/queries.ts`
  - `examples/web-todomvc-sync-cf/src/livestore/queries.ts`
- [ ] Update `Header.tsx` and `Footer.tsx` in the two consuming TodoMVC examples
      so event payloads include the explicit key/session identity required by
      the new client-only event and no type uses `table.Value`.
- [ ] Apply the same explicit schema/event/materializer/query shape to the
      mirrored getting-started, Expo, Vue, Solid, custom-elements, and
      Storybook code assets under `docs/src/content/_assets/code/`.

#### Web email example

- [ ] Change `examples/web-email-client/src/stores/mailbox/schema.ts` to define
      UI state as a normal table with explicit client-only events and
      materializers.
- [ ] Replace `mailboxStore.useClientDocument()` in `AppLayout.tsx`,
      `LabelSidebar.tsx`, and `ThreadList.tsx` with normal `useQuery` reads and
      explicit event commits.
- [ ] Keep any convenience wrapper private to the example. Do not export a
      reusable LiveStore client-document substitute.

#### LinearLite example

- [ ] Replace the three client-document definitions in
      `examples/web-linearlite/src/livestore/schema/{filter-state,frontend-state,scroll-state}.ts`
      with ordinary table definitions.
- [ ] Add explicit client-only event definitions and materializers to the
      LinearLite schema composition.
- [ ] Reimplement the existing app-local hooks in
      `examples/web-linearlite/src/livestore/queries.ts` with `useQuery` and
      explicit commits. They may retain their current tuple shape so the many
      component call sites do not need unrelated churn.
- [ ] Replace `tables.filterState.get()` and document `Value` type lookups with
      normal query and schema/table row types.

#### Test and performance applications

- [ ] Convert the devtools TodoMVC fixture under
      `tests/integration/src/tests/playwright/fixtures/devtools/todomvc/` to an
      ordinary table, explicit client-only event/materializer, and normal
      query.
- [ ] Convert `tests/perf/test-app/src/schema.ts`,
      `tests/perf/test-app/src/queries.ts`,
      `tests/perf/test-app/src/main.tsx`, and
      `tests/perf-eventlog/test-app/src/livestore/{schema,queries}.ts`,
      replacing `.Value` aliases with ordinary row/value types.
- [ ] Preserve the measured workload and eventlog behavior; only the
      client-document construction and hidden registration should disappear.

### 2. Remove the React and framework-toolkit surfaces

- [ ] Delete:
  - `packages/@livestore/react/src/useClientDocument.ts`
  - `packages/@livestore/react/src/useClientDocument.test.tsx`
  - `packages/@livestore/react/src/__snapshots__/useClientDocument.test.tsx.snap`
  - `packages/@livestore/framework-toolkit/src/client-document.ts`
- [ ] In `packages/@livestore/react/src/useStore.ts`:
  - remove the `useClientDocument` import;
  - remove `ReactApi.useClientDocument`;
  - stop attaching the method in `withReactApi()`;
  - update JSDoc and examples to list only the remaining augmented methods.
- [ ] In `packages/@livestore/react/src/mod.ts`, remove exports for
      `useClientDocument`, `UseClientDocumentResult`, and the client-document
      setter types.
- [ ] In `packages/@livestore/framework-toolkit/src/mod.ts` and `types.ts`,
      remove client-document utilities and types while retaining query
      normalization, resource creation, stack-info, and `NormalizedQueryable`.
- [ ] Simplify `packages/@livestore/framework-toolkit/src/testing.ts` to the
      normal TodoMVC tables/events used by the surviving React query tests.
- [ ] Update `packages/@livestore/react/src/__tests__/fixture.tsx` only as
      needed for the simplified shared fixture.
- [ ] Replace the `useClientDocument` frames in
      `packages/@livestore/livestore/src/utils/stack-info.test.ts` with a
      surviving custom-hook/`useQuery` stack so stack filtering remains tested
      without retaining removed names.

### 3. Remove the core table definition and implicit schema paths

- [ ] Delete:
  - `packages/@livestore/common/src/schema/state/sqlite/client-document-def.ts`
  - `packages/@livestore/common/src/schema/state/sqlite/client-document-def.test.ts`
  - `packages/@livestore/common/src/__tests__/fixture.ts` if it remains unused
    after the dedicated tests are removed.
- [ ] Remove every client-document export from
      `packages/@livestore/common/src/schema/state/sqlite/mod.ts`.
- [ ] Remove the client-document scan from `State.SQLite.makeState()`.
      `inputSchema.materializers` must become the only user-state materializer
      registration path.
- [ ] Remove the client-document scan from
      `packages/@livestore/common/src/schema/schema.ts`. `inputSchema.events`
      must become the only application event registration path.
- [ ] Remove `isClientDocumentTable` from `TableOptions`, `WithDefaults`, and
      normal `table()` construction in `table-def.ts`.
- [ ] If `TableDef.options` and its second generic parameter have no remaining
      purpose after that marker is gone, remove them in the same mechanical
      cleanup and update `TableDefBase`/`QueryBuilder` constraints. Do not leave
      an empty public metadata object solely as a fossil of client documents.
- [ ] Keep JSON schema information in the SQLite schema hash because it applies
      to ordinary typed JSON columns; update the comment in
      `db-schema/ast/sqlite.ts` so it no longer claims this exists for client
      documents.

### 4. Remove `RowQuery` and read-time writes

- [ ] In `query-builder/api.ts`:
  - remove `QueryBuilderAst.RowQuery` from the union and delete its interface;
  - delete the public `RowQuery` namespace and its get/default/document-result
    helper types;
  - remove the unused `'row'` API feature and its mechanical omissions from
    query-builder method return types;
  - remove imports that existed only for the row/document branch.
- [ ] In `query-builder/astToSql.ts`, delete `RowQuery` SQL generation and its
      special `SessionIdSymbol` encoding bypass.
- [ ] In `query-builder/impl.ts`, remove row guards, the row result schema
      branch, `isRowQuery()`, and the dead commented `getOrCreate()` prototype.
- [ ] Remove the unused client-document definitions from
      `query-builder/impl.test.ts`; leave all normal select/count/write coverage
      intact.
- [ ] Delete
      `packages/@livestore/livestore/src/live-queries/client-document-get-query.ts`.
- [ ] In `live-queries/db-query.ts`:
  - remove row-specific imports, labels, and AST branches;
  - remove `execBeforeFirstRun` from `QueryInputRaw`;
  - remove the one-shot callback refs and execution block;
  - preserve generic `SessionIdSymbol` hashing and bind-value resolution.
- [ ] In `store/store.ts`, remove the `RowQuery` preflight commit from direct
      `store.query()` and update the remaining session-symbol comment to be
      query-generic.
- [ ] Remove the `RowQuery` re-export from
      `packages/@livestore/livestore/src/mod.ts`.
- [ ] Replace the client-document example in `store/store-types.ts` and remove
      the unused client-document table from
      `packages/@livestore/livestore/src/utils/tests/fixture.ts`.
- [ ] Verify there is no query path left that calls `store.commit()` before
      executing a read.

### 5. Remove or retarget client-document tests and shared fixtures

#### Delete tests whose subject no longer exists

- [ ] Delete:
  - `tests/package-common/src/client-document-optimistic-integration.test.ts`
  - `tests/package-common/src/client-document-optimistic-schema.test.ts`
  - `tests/package-common/src/issue-487.test.ts`
- [ ] Delete `tests/package-common/src/todomvc-fixture.ts` if its current
      no-import status is unchanged; otherwise reduce it to normal tables and
      explicit events.

#### Preserve coverage for retained infrastructure

- [ ] Rewrite `tests/package-common/src/session-id-symbol.test.ts` around a
      normal table and explicit client-only event. Continue asserting that:
  - caller-owned event args keep `SessionIdSymbol`;
  - the encoded/materialized event uses the concrete session id;
  - the resulting row is keyed by `store.sessionId`.
- [ ] Update the public examples in
      `packages/@livestore/common/src/session-id-symbol.ts` and the encoding
      comment in `sync/ClientSessionSyncProcessor.ts` to describe explicit
      session-scoped events/queries rather than client documents. Do not remove
      the resolution behavior.
- [ ] Replace the client document in
      `tests/package-common/src/leader-thread/fixture.ts` with an explicit
      `app_configSet` client-only event and materializer.
- [ ] Update `leader-thread/stream-events.test.ts`,
      `leader-thread/LeaderSyncProcessor.test.ts`, and
      `client-session/ClientSessionSyncProcessor.test.ts` to use that explicit
      event while preserving their pending-event, rebase, and stream-order
      assertions.
- [ ] Rename test descriptions such as “client document pending events” to
      “client-only pending events” so they describe the retained contract.
- [ ] Remove obsolete `derived events are missing` comments or casts if the
      explicit fixture resolves them.
- [ ] Keep React coverage for `useStore`, `useQuery`, `useSyncStatus`, resource
      identity, and StrictMode. Only the removed hook's tests and snapshots
      should disappear.

### 6. Update the intent layer, then derive current documentation from it

Do not update protected requirements until maintainer confirmation from step 0.
Because the behavior is changing, update the owning `context/` nodes before
editing the derived docs site.

#### Intent layer

- [ ] Add an accepted SQLite-state decision, expected at
      `context/02-system/02-state/01-sqlite/.decisions/0002-remove-client-document-api.md`,
      citing RFC 0003 and recording the explicit event/table/materializer/query
      model. Record that no replacement convenience API is introduced.
- [ ] Retire (do not reuse) `LS.SYS.STATE.SQLITE-R03`,
      `LS.SYS.STATE.SQLITE-R07`, and `LS.SYS.INT-R06`, with links to the new
      decision.
- [ ] Update:
  - `context/spec.md`
  - `context/ontology.md`
  - `context/02-system/01-event-model/{requirements,spec}.md`
  - `context/02-system/02-state/{requirements,spec,intuition}.md`
  - `context/02-system/02-state/01-sqlite/{requirements,spec}.md`
  - `context/02-system/05-store/01-reactivity/{requirements,spec,realizations}.md`
  - `context/02-system/08-integrations/{requirements,spec,intuition}.md`
  - `context/02-system/08-integrations/01-react/{requirements,spec}.md`
  - `context/02-system/09-verification/01-lanes/spec.md`
- [ ] Remove “Client document” from the ontology, derivation table, and client
      term family.
- [ ] Remove client documents from the SQLite, query-kind, integration-toolkit,
      React-hook, and verification contracts. Keep the client-only event and
      session identity contracts.
- [ ] If the generic derived-event mechanism is retained, rewrite examples and
      descriptions so client documents are not presented as its active
      producer.
- [ ] Mark the client-document consequence in
      `context/02-system/03-sync/01-syncstate/.decisions/0001-total-order-rebase-default.md`
      as superseded by the new removal decision rather than erasing historical
      context.

#### Current docs and snippets

- [ ] Remove the client-document sections and imports from:
  - `docs/src/content/docs/building-with-livestore/state/sqlite-schema.mdx`
  - `docs/src/content/docs/framework-integrations/react-integration.mdx`
  - `docs/src/content/docs/framework-integrations/vue-integration.mdx`
  - `docs/src/content/docs/overview/concepts.md`
- [ ] Delete the dedicated snippets:
  - `docs/src/content/_assets/code/reference/state/sqlite-schema/columns/client-document-basic.tsx`
  - `docs/src/content/_assets/code/reference/state/sqlite-schema/columns/client-document-kv.tsx`
  - `docs/src/content/_assets/code/reference/framework-integrations/react/use-client-document.tsx`
  - `docs/src/content/_assets/code/reference/framework-integrations/vue/use-client-document.vue`
- [ ] Rewrite the Storybook and tutorial material that currently depends on
      client documents. Use existing ordinary tables and explicit client-only
      events where persisted client state is still part of the lesson, or
      remove that lesson if persistence is not essential.
- [ ] Do not add a “how to migrate from client documents” page, compatibility
      recipe, or replacement helper as part of this change.
- [ ] Remove links to the generated `clientDocument` API page. The API page
      should disappear naturally when the exports are removed.
- [ ] Re-run snippet/type checking so mirrored getting-started sources do not
      preserve hidden `.get()`, `.set()`, `.Value`, or generated-event usage.

### 7. Record the breaking release impact

- [ ] Add a changeset with the repository's pre-1.0 breaking-change level
      (`minor`) for:
  - `@livestore/common`
  - `@livestore/livestore`
  - `@livestore/react`
  - `@livestore/framework-toolkit`
- [ ] Add an `Unreleased` breaking-change entry to `CHANGELOG.md` that names the
      removed exports and behavior and links the tracking issue/PR.
- [ ] Keep old `CHANGELOG.md` release sections and
      `release/release-notes.md` unchanged as historical records.
- [ ] Keep RFC 0003 as the design/history record; do not turn the implementation
      PR into a broader migration-framework project.

### 8. Verification and completion audit

Run targeted checks first, then repository-wide gates.

- [ ] Run the directly affected Vitest files for the query builder,
      `SessionIdSymbol`, client-session sync processor, leader sync/stream
      behavior, React `useQuery`, and React `useStore`.
- [ ] Run the intent-layer invariant suite:

  ```sh
  devenv shell -- vitest run tests/package-common/src/intent-layer/intent-layer.test.ts
  ```

- [ ] Run formatting/lint auto-fixes and then verify:

  ```sh
  devenv tasks run lint:full:fix
  devenv tasks run ts:check
  ```

- [ ] Build current documentation and test examples:

  ```sh
  mono docs build
  mono examples test
  ```

- [ ] Run the full suite before pushing:

  ```sh
  devenv tasks run test:run
  ```

- [ ] Run the relevant browser and performance smoke tests for the converted
      devtools/TodoMVC and perf fixtures if they are not covered by the full
      task.
- [ ] Perform a final source audit. Outside RFC 0003, the new decision, and
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
- Type checking, linting, docs, examples, intent invariants, targeted tests,
  and the full test suite pass.
