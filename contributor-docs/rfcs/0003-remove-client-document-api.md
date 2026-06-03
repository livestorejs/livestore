# Remove Client Document API

## Context

LiveStore applications define state as SQLite tables and derive that state by committing events that are processed by materializers:

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

LiveStore also supports client-only events. Client-only events are persisted locally on the client and are synced across browser tabs but are not sent to the server. Client documents are a convenience API built on top of client-only events. For example:

```ts
const tables = {
  uiState: State.SQLite.clientDocument({
    name: 'UiState',
    schema: Schema.Struct({
      input: Schema.String,
      filter: Schema.Literal('All', 'Active', 'Completed'),
    }),
    default: {
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

This is useful for UI state that should survive refreshes and stay in sync across tabs, such as theme preference, text size, and draft state.

## Problem

> **Problem Statement**: The Client Document API adds public surface area and internal special cases for a convenience pattern that is not essential to LiveStore's core value, making the product more complex and harder to maintain.

### 1. Maintenance Cost

Client documents are not just a thin helper around public APIs. They require special handling in schema construction, query building, live query execution, framework integrations, type definitions, docs, examples, and tests.

#### A Special Table Definition Type

Client documents introduce a separate table kind with `ClientDocumentTableDef`, `ClientDocumentTableDefSymbol`, `ClientDocumentTableOptions`, `tableIsClientDocumentTable()`, generated `.get()`, generated `.set()`, default ids, and `partialSet` behavior.

This makes table definitions carry event and materializer metadata in addition to SQLite schema metadata.

#### Hidden Schema Registration Paths

LiveStore must detect client document tables while building the schema and auto-register their generated events and materializers.

This adds an implicit schema path:

- Normal events are added from the schema's `events` object.
- Normal materializers are added from `State.SQLite.materializers()`.
- Client document events and materializers are derived from table definitions.

Removing client documents would make event and materializer registration fully explicit again.

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

It forces live query execution and direct `store.query()` paths to know about client document initialization.

#### Additional Framework API Surface

The React integration needs its own `useClientDocument` API surface and type behavior. This hook is not just a query hook; it combines:

- A query.
- A setter.
- Default id resolution.
- Current-session id resolution.
- Partial update typing.
- Access to the underlying `LiveQuery`.

Removing client documents would keep framework integrations focused on `useStore()` and `useQuery()`.

### 2. Breaks the Core LiveStore Model

LiveStore's conceptual model is intentionally explicit:

- Events record what happened.
- Materializers derive SQLite state from those events.
- Queries read the materialized state.

Client documents blur each of those boundaries. It modifies the conceptual model in a way that dilutes and complicates the original one.

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

The second form is shorter, but the event log now records a generic `UiStateSet` event instead of a more meaningful fact such as `FilterChanged`.

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

This brings in hidden behavior, which can confuse users.

#### Schema Evolution Follows a Separate Policy

Client documents include an optimistic decoding strategy for historical document values and generated setter events. The decoder attempts to preserve compatible fields, drop removed fields, and fall back to defaults when structures are incompatible.

This is pragmatic for UI state, but it creates a second migration/evolution model beside ordinary event and materializer evolution. It also means incompatible changes may silently reset client-document state.

## Proposed Solution

Remove the client document API from LiveStore and replace its documented use cases with explicit client-only events, normal SQLite tables, and small framework-level helper recipes.

Client-only events remain the LiveStore-native way to persist local/client-specific state.

### Migration Paths

Removing the Client Document API should not imply that every former client document should be migrated the same way. The migration path should be chosen based on what kind of state it is.

#### Path 1: Move UI-Only State Out of LiveStore

Some state does not need to be in LiveStore. If a value is only used by the view layer and does not need to participate in LiveStore queries, materializers, persistence, cross-tab/client-session sync, it should use ordinary UI state instead.

In React, this can be `useState()`, `useReducer()`, or a small component-local store. For app-local reactive state outside React, Effect Atom may be a better fit than storing the value in LiveStore just because it is state.

```tsx
const [isCommandPaletteOpen, setCommandPaletteOpen] = React.useState(false)
```

This path removes LiveStore from state it does not need to own.

#### Path 2: Model LiveStore-Relevant State With Client-Only Events

Some local/client-specific state should remain in because it should be persisted in the same storage model, because it needs cross-tab/client-session sync, or because it is useful to inspect as part of the local event/state graph.

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

For that case, applications can replicate the client document shape explicitly with a normal table, a JSON `value` column, a generic client-only patch event, and a materializer that applies top-level JSON updates:

```tsx
import { Events, makeSchema, queryDb, Schema, State } from '@livestore/livestore'
import { useAppStore } from './store.ts'

const UiState = Schema.Struct({
  input: Schema.String,
  filter: Schema.Literal('All', 'Active', 'Completed'),
})

const defaultUiState = { input: '', filter: 'All' } as const
const uiStateId = 'default'

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

const encodeValue = Schema.encodeSync(Schema.parseJson(UiState))
const encodePatch = Schema.encodeSync(Schema.partial(UiState))

const materializers = State.SQLite.materializers(events, {
  'v1.UiStatePatched': ({ id, patch }) => {
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<typeof UiState.Type>
    const encodedPatch = encodePatch(cleanPatch)

    let jsonSetSql = 'value'
    const bindValues: unknown[] = [id, encodeValue({ ...defaultUiState, ...cleanPatch })]

    for (const [key, value] of Object.entries(encodedPatch)) {
      jsonSetSql = `json_set(${jsonSetSql}, ?, json(?))`
      bindValues.push(`$.${key}`, JSON.stringify(value))
    }

    return {
      sql: `
        INSERT INTO 'UiState' (id, value)
        VALUES (?, ?)
        ON CONFLICT (id) DO UPDATE SET value = ${jsonSetSql}
      `,
      bindValues,
      writeTables: new Set(['UiState']),
    }
  },
})

const state = State.SQLite.makeState({ tables, materializers })
export const schema = makeSchema({ events, state })

export const uiState$ = queryDb(
  tables.uiState
    .select()
    .where({ id: uiStateId })
    .first({ behaviour: 'fallback', fallback: () => ({ id: uiStateId, value: defaultUiState }) }),
  { label: 'uiState' },
)

export const TodoHeader = () => {
  const store = useAppStore()
  const { value: uiState } = store.useQuery(uiState$)

  const setUiState = (patch: Partial<typeof UiState.Type>) =>
    store.commit(events.uiStatePatched({ id: uiStateId, patch }))

  return (
    <input
      value={uiState.input}
      onChange={(event) => setUiState({ input: event.currentTarget.value })}
      placeholder="What needs to be done?"
    />
  )
}
```

This path intentionally preserves the old document-style model, but moves it out of the core API. It should be treated as a low-friction migration path, not the recommended modeling style for new code.
