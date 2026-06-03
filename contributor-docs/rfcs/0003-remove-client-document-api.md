# Remove Client Document API

## Context

LiveStore applications define state as SQLite tables and derive that state by committing events that are processed by materializers.

For durable application data, users usually define:

```ts
const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean({ default: false }),
    },
  }),
}

const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': defineMaterializer(events.todoCreated, ({ id, text }) =>
    tables.todos.insert({ id, text, completed: false }),
  ),
})
```

LiveStore also supports client-only events. Client-only events are processed locally on the client and can be synced across client sessions such as browser tabs/windows, but are not part of the synced domain event stream shared with other clients.

Client documents are a convenience API for persisted client-specific state. A table declared with `State.SQLite.clientDocument()` currently expands into:

- A SQLite table with `id` and `value` columns.
- A generated client-only setter event named `${DocumentName}Set`.
- A generated materializer that upserts the document.
- A `.get()` query helper that returns the document value.
- A `.set()` event helper that commits partial or full document updates.
- Framework hooks such as `store.useClientDocument()`.

For example:

```ts
const tables = {
  uiState: State.SQLite.clientDocument({
    name: 'UiState',
    schema: Schema.Struct({
      input: Schema.String,
      filter: Schema.Literal('All', 'Active', 'Completed'),
    }),
    default: {
      id: SessionIdSymbol,
      value: { input: '', filter: 'All' },
    },
  }),
}
```

React components can then use the generated document with `useState`-like ergonomics:

```tsx
const [{ input, filter }, setUiState, , uiState$] = store.useClientDocument(tables.uiState)

setUiState({ filter: 'Completed' })
```

This is useful for UI state that should survive refreshes and participate in LiveStore reactivity, such as selected filters, draft text, scroll state, selected tabs, and local layout preferences.

The API exists because LiveStore applications often have state that sits between framework-local state and durable domain data:

- Framework-local state such as `React.useState()` is easy to update, but it is lost on refresh and cannot be used as a first-class dependency in LiveStore queries.
- Durable domain data belongs in explicit synced events and materializers, but that ceremony is often too heavy for local UI details such as a filter tab or draft input.
- Client-specific UI state still benefits from LiveStore's persistence, schema validation, reactivity graph, DevTools visibility, and adapter/session storage model.

Client documents therefore provide a shorthand for a repeated pattern: a single local document, a default value, a client-only setter event, an upsert materializer, a get-or-create read helper, and a framework hook with `useState`-like setter ergonomics.

## Problem

> **Problem Statement**: The Client Document API adds public surface area and internal special cases for a convenience pattern that is not essential to LiveStore's core value, making the product harder to maintain at the level of quality expected from a data layer.

Client documents are valuable because they make a common task easy: persisted local UI state. The problem is not that this use case is unimportant. The problem is that the current API solves it by introducing a second state-modeling path beside LiveStore's core event/materializer model.

### 1. Maintenance Cost

Client documents are not a thin helper around public APIs. They require special handling in core schema construction, query building, live query execution, framework integrations, type definitions, docs, examples, and tests.

This maintenance cost matters because LiveStore is a data-layer product where quality depends on making the core model reliable, understandable, and recoverable. Every extra public abstraction expands the set of behavior that must be designed, tested, documented, migrated, and supported. That cost compounds across adapters, framework integrations, examples, generated docs, and user expectations. Removing a convenience API that duplicates expressible core behavior lets implementation effort concentrate on making the essential event, materializer, query, persistence, and sync paths excellent.

#### A Special Table Definition Type

Client documents introduce a separate table kind with `ClientDocumentTableDef`, `ClientDocumentTableDefSymbol`, `ClientDocumentTableOptions`, `tableIsClientDocumentTable()`, generated `.get()`, generated `.set()`, default ids, and `partialSet` behavior.

This makes table definitions carry event and materializer metadata in addition to SQLite schema metadata.

#### Hidden Schema Registration Paths

LiveStore must detect client document tables while building the schema and auto-register their generated events and materializers.

This adds an implicit schema path:

- Normal events are added from the schema's `events` object.
- Normal materializers are added from `State.SQLite.materializers()`.
- Client document events and materializers are derived from table definitions.

Removing client documents would make event and materializer registration explicit again.

#### A Query Builder Special Case

Client documents introduce a `RowQuery` AST variant. Row queries differ from normal select queries:

- They are tied to `ClientDocumentTableDef`.
- They carry an id and explicit default values.
- They return the `value` column instead of a row.
- They reject normal query-builder operations such as `.where()` and `.count()`.
- They require custom labels and pre-run behavior in live queries.

This is a meaningful amount of query-system complexity for an API that can be expressed with normal tables, normal queries, and explicit client-only events.

#### Special Live Query Execution Behavior

At runtime, row queries need a `makeExecBeforeFirstRun()` path that can run before the first query execution and commit a default event with `skipRefresh`.

This is the implementation consequence of the read-can-write conceptual issue. It forces live query execution and direct `store.query()` paths to know about client document initialization.

#### Generic JSON Patch Semantics

Client documents default to partial-set behavior for struct-like documents:

```ts
setUiState({ filter: 'Completed' })
```

The generated materializer must support:

- Insert with defaults when the document does not exist.
- Merge partial patches into an existing JSON value.
- Skip `undefined` values.
- Fully replace values when `partialSet: false`.
- Handle non-struct schemas differently from struct schemas.
- Encode and decode custom Effect schemas correctly.

These semantics are useful but generic. Applications that need this behavior can define it explicitly, and applications that need different behavior currently need to bypass the client document abstraction anyway.

#### Additional Framework API Surface

The React integration needs its own `useClientDocument` API surface and type behavior. This hook is not just a query hook; it combines:

- A query.
- A setter.
- Default id resolution.
- `SessionIdSymbol` resolution.
- Partial update typing.
- Access to the underlying `LiveQuery`.

Removing client documents would keep framework integrations focused on `useStore()` and `useQuery()`. Applications could still define their own domain-specific hooks on top of explicit events and queries.

### 2. Breaks the Core LiveStore Model

LiveStore's conceptual model is intentionally explicit:

- Events record what happened.
- Materializers derive SQLite state from those events.
- Queries read the materialized state.
- Framework integrations subscribe to queries and commit events.

Client documents blur each of those boundaries.

#### Tables Also Define Events and Materializers

In the standard model, events and materializers are explicit parts of the schema. With client documents, a table declaration also defines a hidden event and a hidden materializer.

This means that these two schema shapes are not equivalent in how they communicate intent:

```ts
// Explicit domain/local event
events.filterChanged({ filter: 'Completed' })
```

```ts
// Generic document mutation
tables.uiState.set({ filter: 'Completed' })
```

The second form is shorter, but the event log now records a generic `UiStateSet` event instead of a meaningful fact such as `FilterChanged`.

#### Queries Can Cause Writes

Client document `.get()` is not just a read. If the row does not exist, LiveStore commits the generated setter event with the default value before the query returns.

This means client document reads can have write effects:

```ts
const uiState = store.query(tables.uiState.get())
```

That behavior is useful for get-or-create ergonomics, but it complicates the mental model:

- Normal query: read state.
- Normal commit: append event and materialize state.
- Client document query: maybe append an event, materialize state, then read state.

LiveStore should avoid read paths that perform writes unless the behavior is essential to the core model.

#### Events Become Generic State Mutations

LiveStore's core model encourages applications to record what happened:

```ts
events.todoCompleted({ id })
events.issueAssigned({ issueId, assigneeId })
events.filterChanged({ filter })
```

Client documents encourage applications to record the new value:

```ts
tables.frontendState.set({ selectedIssueId })
tables.uiState.set({ filter })
tables.composerState.set({ draft })
```

That is often fine for local UI state, but the API can become a dumping ground for state that should have been modeled as explicit events. Broad documents such as `uiState`, `frontendState`, and `appState` are especially likely to accumulate unrelated fields over time.

#### Schema Evolution Follows a Separate Policy

Client documents include an optimistic decoding strategy for historical document values and generated setter events. The decoder attempts to preserve compatible fields, drop removed fields, and fall back to defaults when structures are incompatible.

This is pragmatic for UI state, but it creates a second migration/evolution model beside ordinary event and materializer evolution. It also means incompatible changes may silently reset client-document state. That is acceptable for low-value UI state, but it is not an appropriate default for anything with business meaning.

## Proposed Solution

Remove the client document API from LiveStore and replace its documented use cases with explicit client-only events, normal SQLite tables, and small framework-level helper recipes.

The removal should happen in one step. The implementation should remove the API, update docs and examples, and provide migration guidance in the same change rather than introducing a deprecation period.

### Scope

Remove these public concepts:

- `State.SQLite.clientDocument()`
- `State.SQLite.ClientDocumentTableDef`
- `State.SQLite.ClientDocumentTableDefSymbol`
- `State.SQLite.tableIsClientDocumentTable()`
- `store.useClientDocument()` in framework integrations
- Any generated client-document setter event behavior
- Client-document-specific get-or-create row query behavior

Keep these concepts:

- `Events.clientOnly()`
- Normal SQLite tables
- Normal materializers
- Normal query builder APIs
- Framework `store.useQuery()` APIs

Client-only events remain the recommended LiveStore-native way to persist local/client-specific state.

### Migration Paths

Removing the Client Document API should not imply that every former client document should be migrated the same way. The migration path should be chosen based on what kind of state it is.

#### Path 1: Move UI-Only State Out of LiveStore

Some state does not need to be in LiveStore. If a value is only used by the view layer and does not need to participate in LiveStore queries, materializers, persistence, cross-tab/client-session sync, or DevTools, it should use ordinary UI state instead.

Examples:

- Modal open/closed state.
- Hovered or focused item.
- Drag state.
- Resize state.
- Command palette state.
- View-only toggles.

In React, this can be `useState()`, `useReducer()`, or a small component-local store. For app-local reactive state outside React, Effect Atom may be a better fit than storing the value in LiveStore just because it is state.

```tsx
const [isCommandPaletteOpen, setCommandPaletteOpen] = React.useState(false)
```

This path removes LiveStore from state it does not need to own.

#### Path 2: Model LiveStore-Relevant State With Client-Only Events

Some local/client-specific state should remain in LiveStore because LiveStore queries need to depend on it, because it should be persisted in the same storage model, because it needs cross-tab/client-session sync, or because it is useful to inspect as part of the local event/state graph.

For that state, use normal tables and explicit `Events.clientOnly()` events.

Given an existing client document:

```ts
const tables = {
  uiState: State.SQLite.clientDocument({
    name: 'UiState',
    schema: Schema.Struct({
      input: Schema.String,
      filter: Schema.Literal('All', 'Active', 'Completed'),
    }),
    default: {
      id: SessionIdSymbol,
      value: { input: '', filter: 'All' },
    },
  }),
}
```

Prefer an explicit table shape:

```ts
const tables = {
  uiState: State.SQLite.table({
    name: 'UiState',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      input: State.SQLite.text({ default: '' }),
      filter: State.SQLite.text({ default: 'All' }),
    },
  }),
}
```

Then define explicit client-only events:

```ts
const Filter = Schema.Literal('All', 'Active', 'Completed')

const events = {
  todoInputChanged: Events.clientOnly({
    name: 'v1.TodoInputChanged',
    schema: Schema.Struct({
      id: Schema.String,
      input: Schema.String,
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

Materialize those events explicitly:

```ts
const materializers = State.SQLite.materializers(events, {
  'v1.TodoInputChanged': defineMaterializer(events.todoInputChanged, ({ id, input }) =>
    tables.uiState.insert({ id, input, filter: 'All' }).onConflict('id', 'update', { input }),
  ),

  'v1.TodoFilterChanged': defineMaterializer(events.todoFilterChanged, ({ id, filter }) =>
    tables.uiState.insert({ id, input: '', filter }).onConflict('id', 'update', { filter }),
  ),
})
```

This is more code than `useClientDocument()`, but the event names now describe what happened, materializers are explicit, and queries remain reads.

If other LiveStore queries need to depend on this state, define the query directly and reuse it:

```ts
const defaultUiState = { input: '', filter: 'All' as const }

const uiState$ = queryDb(
  tables.uiState
    .select('input', 'filter')
    .where({ id: store.sessionId })
    .first({ behaviour: 'fallback', fallback: () => defaultUiState }),
)

const todos$ = queryDb(
  (get) => {
    const { filter } = get(uiState$)
    return tables.todos.where({
      completed: filter === 'Completed' ? true : filter === 'Active' ? false : undefined,
    })
  },
  { label: 'todos' },
)
```

This path is the preferred LiveStore-native migration for state that participates in LiveStore's reactivity graph.

#### Path 3: Replicate the Client Document Model With Public Primitives

Some applications may want the least disruptive migration, especially if they have many existing client documents and want to preserve the same "single document with patch updates" model.

For that case, applications can replicate the client document shape explicitly with a normal table, a JSON `value` column, and a generic client-only patch event:

```ts
const UiState = Schema.Struct({
  input: Schema.String,
  filter: Schema.Literal('All', 'Active', 'Completed'),
})

const tables = {
  uiState: State.SQLite.table({
    name: 'UiState',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      value: State.SQLite.json({ schema: UiState }),
    },
  }),
}

const events = {
  uiStatePatched: Events.clientOnly({
    name: 'v1.UiStatePatched',
    schema: Schema.Struct({
      id: Schema.String,
      patch: Schema.partial(UiState),
    }),
  }),
}
```

The application can then define a small helper that commits `uiStatePatched` and a materializer that applies the patch to the `value` column.

This path intentionally preserves the old document-style model, but moves it out of LiveStore core. It should be treated as a low-friction migration path, not the recommended modeling style for new code.

### Removal Work

The implementation should remove the API directly:

- Remove `State.SQLite.clientDocument()`.
- Remove `ClientDocumentTableDef` types.
- Remove generated setter event/materializer registration.
- Remove `RowQuery` if no other feature needs get-or-create row semantics.
- Remove `makeExecBeforeFirstRun()` client-document default-row behavior.
- Remove `store.useClientDocument()` from framework integrations.
- Convert core examples away from client documents.
- Convert tutorial chapter 6 to explicit client-only events.
- Update docs, generated snippets, MCP content, generated API docs, and client-document-specific tests.
