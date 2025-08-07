---
title: Materializers
sidebar:
  order: 5
---

Materializers are functions that allow you to write to your database in response to events. Materializers are executed in the order of the events in the eventlog.

## Example

```ts

const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  userPreferencesUpdated: Events.synced({
    name: 'userPreferencesUpdated',
    schema: Schema.Struct({ userId: Schema.String, theme: Schema.String }),
  }),
  factoryResetApplied: Events.synced({
    name: 'factoryResetApplied',
    schema: Schema.Struct({ }),
  }),
}

/**
 * A materializer function receives two arguments:
 * 1. `eventPayload`: The deserialized data of the event.
 * 2. `context`: An object containing:
 *    - `query`: A function to execute read queries against the current state of the database within the transaction.
 *    - `db`: The raw database instance (e.g., a Drizzle instance for SQLite).
 *    - `event`: The full event object, including metadata like event ID and timestamp.
 */
const materializers = State.SQLite.materializers(events, {
  // Example of a single database write
  todoCreated: ({ id, text, completed }, ctx) => todos.insert({ id, text, completed: completed ?? false }),

  // Materializers can also have no return if no database writes are needed for an event
  userPreferencesUpdated: ({ userId, theme }, ctx) => {
    console.log(`User ${userId} updated theme to ${theme}. Event ID: ${ctx.event.id}`);
    // No database write in this materializer
  },

  // It's also possible to return multiple database writes as an array
  factoryResetApplied: (_payload, ctx) => [
    table1.update({ someVal: 0 }),
    table2.update({ otherVal: 'default' }),
    // ...
  ]
}
```

## Reading from the database in materializers

Sometimes it can be useful to query your current state when executing a materializer. This can be done by using `ctx.query` in your materializer function.

```ts
const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }, ctx) => {
    const previousIds = ctx.query(todos.select('id'))
    return todos.insert({ id, text, completed: completed ?? false, previousIds })
  },
}
```

## Transactional behaviour

A materializer is always executed in a transaction. This transaction applies to:
- All database write operations returned by the materializer.
- Any `ctx.query` calls made within the materializer, ensuring a consistent view of the data.

Materializers can return:
- A single database write operation.
- An array of database write operations.
- `void` (i.e., no return value) if no database modifications are needed.
- An `Effect` that resolves to one of the above (e.g., `Effect.succeed(writeOp)` or `Effect.void`).

The `context` object passed to each materializer provides `query` for database reads, `db` for direct database access if needed, and `event` for the full event details.

## Error Handling

If a materializer function throws an error, or if an `Effect` returned by a materializer fails, the entire transaction for that event will be rolled back. This means any database changes attempted by that materializer for the failing event will not be persisted. The error will be logged, and the system will typically halt or flag the event as problematic, depending on the specific LiveStore setup.

If the error happens on the client which tries to commit the event, the event will never be committed and pushed to the sync backend.

In the future there will be ways to configure the error-handling behaviour, e.g. to allow skipping an incoming event when a materializer fails in order to avoid the app getting stuck. However, skipping events might also lead to diverging state across clients and should be used with caution.

## Best practices

### Side-effect free / deterministic

It's strongly recommended to make sure your materializers are side-effect free and deterministic. This also implies passing in all necessary data via the event payload.

Example:

```ts
// Don't do this
const events = {
  todoCreated: Events.synced({
    name: "v1.TodoCreated",
    schema: Schema.Struct({ text: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  "v1.TodoCreated": ({ text }) =>
    tables.todos.insert({ id: crypto.randomUUID(), text }),
  //                          ^^^^^^^^^^^^^^^^^^^
  //                          This is non-deterministic
})

store.commit(events.todoCreated({ text: 'Buy groceries' }))

// Instead do this
const events = {
  todoCreated: Events.synced({
    name: "v1.TodoCreated",
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    //                      ^^^^^^^^^^^^^^^^^
    //                      Also include the id in the event payload
  }),
}

const materializers = State.SQLite.materializers(events, {
  "v1.TodoCreated": ({ id, text }) => tables.todos.insert({ id, text }),
})

store.commit(events.todoCreated({ id: crypto.randomUUID(), text: 'Buy groceries' }))
```
