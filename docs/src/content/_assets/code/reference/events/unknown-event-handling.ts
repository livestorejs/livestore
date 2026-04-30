import { defineMaterializer, Events, makeSchema, Schema, State } from '@livestore/livestore'

const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
    },
  }),
} as const

const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
} as const

const materializers = State.SQLite.materializers(events, {
  [events.todoCreated.name]: defineMaterializer(events.todoCreated, ({ id, text }) =>
    tables.todos.insert({ id, text }),
  ),
})

const state = State.SQLite.makeState({ tables, materializers })

// ---cut---

const _schema = makeSchema({
  events,
  state,
  unknownEventHandling: {
    strategy: 'callback',
    onUnknownEvent: (event, error) => {
      console.warn('LiveStore saw an unknown event', { event, reason: error.reason })
    },
  },
})
