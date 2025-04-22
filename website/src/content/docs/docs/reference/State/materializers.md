---
title: Materializers
sidebar:
  order: 4
---

Materializers are functions that allow you to write to your database in response to events.

## Example

```ts

const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  factoryResetApplied: Events.synced({
    name: 'factoryResetApplied',
    schema: Schema.Struct({ }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }, ctx) => todos.insert({ id, text, completed: completed ?? false }),
  // It's also possible to return multiple database writes
  factoryResetApplied: () => [
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

A materializer is always executed in a transaction which applies both for the returned write operations as well for `query` calls.

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

### Performance