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