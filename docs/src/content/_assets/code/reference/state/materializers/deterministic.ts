import { randomUUID } from 'node:crypto'
import { defineMaterializer, Events, nanoid, Schema, State, type Store } from '@livestore/livestore'

import { todos } from './example.ts'

declare const store: Store

export const nondeterministicEvents = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ text: Schema.String }),
  }),
} as const

export const nondeterministicMaterializers = State.SQLite.materializers(nondeterministicEvents, {
  [nondeterministicEvents.todoCreated.name]: defineMaterializer(nondeterministicEvents.todoCreated, ({ text }) =>
    todos.insert({ id: randomUUID(), text }),
  ),
})

store.commit(nondeterministicEvents.todoCreated({ text: 'Buy groceries' }))

export const deterministicEvents = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
} as const

export const deterministicMaterializers = State.SQLite.materializers(deterministicEvents, {
  [deterministicEvents.todoCreated.name]: defineMaterializer(deterministicEvents.todoCreated, ({ id, text }) =>
    todos.insert({ id, text }),
  ),
})

store.commit(deterministicEvents.todoCreated({ id: nanoid(), text: 'Buy groceries' }))
