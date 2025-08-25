import { makeAdapter } from '@livestore/adapter-node'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { createStore } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  todoCreatedRaw: Events.synced({
    name: 'todoCreatedRaw',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  emptyEventPayload: Events.synced({
    name: 'emptyEventPayload',
    schema: Schema.Void,
  }),
}

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    previousIds: State.SQLite.json({ schema: Schema.Array(Schema.String) }),
  },
})

const tables = { todos }

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }, ctx) => {
    const previousIds = ctx.query(todos.select('id'))
    return todos.insert({ id, text, completed: completed ?? false, previousIds })
  },
  todoCreatedRaw: ({ id, text, completed }, ctx) => {
    const previousIds = ctx.query({ query: 'SELECT id FROM todos', bindValues: {} }).map((_: any) => _.id as string)
    return todos.insert({ id, text, completed: completed ?? false, previousIds })
  },
  emptyEventPayload: () => [],
})

const schema = makeSchema({ events, state: State.SQLite.makeState({ tables, materializers }) })

Vitest.describe.each(['raw', 'query-builder'] as const)('materializer', (queryType) => {
  Vitest.scopedLive('should allow queries in materializer', (test) =>
    Effect.gen(function* () {
      const adapter = makeAdapter({ storage: { type: 'in-memory' } })
      const eventDef = queryType === 'query-builder' ? events.todoCreated : events.todoCreatedRaw

      const store = yield* createStore({
        schema,
        adapter,
        storeId: 'test',
      })
      store.commit(eventDef({ id: 'a', text: 'a' }))
      store.commit(eventDef({ id: 'b', text: 'b' }))
      store.commit(eventDef({ id: 'c', text: 'c' }))

      const todos = store.query(tables.todos)

      expect(todos).toMatchObject([
        { completed: false, id: 'a', text: 'a', previousIds: [] },
        { completed: false, id: 'b', text: 'b', previousIds: ['a'] },
        { completed: false, id: 'c', text: 'c', previousIds: ['a', 'b'] },
      ])
    }).pipe(Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('should allow empty event payload', (test) =>
    Effect.gen(function* () {
      const adapter = makeAdapter({ storage: { type: 'in-memory' } })
      const store = yield* createStore({ schema, adapter, storeId: 'test' })
      store.commit(events.emptyEventPayload())
    }).pipe(Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('should pass full event with clientId to materializer', (test) =>
    Effect.gen(function* () {
      const testClientId = 'test-client-123'
      const messageEvents = {
        messageCreated: Events.synced({
          name: 'messageCreated',
          schema: Schema.Struct({
            id: Schema.String,
            content: Schema.String,
          }),
        }),
      }

      const messageTable = State.SQLite.table({
        name: 'messages',
        columns: {
          id: State.SQLite.text({ primaryKey: true }),
          content: State.SQLite.text(),
          createdBy: State.SQLite.text(),
        },
      })

      const messageMaterializers = State.SQLite.materializers(messageEvents, {
        messageCreated: ({ id, content }, context) => {
          const clientId = context.event.clientId
          return messageTable.insert({
            id,
            content,
            createdBy: clientId,
          })
        },
      })

      const messageSchema = makeSchema({
        events: messageEvents,
        state: State.SQLite.makeState({
          tables: { messages: messageTable },
          materializers: messageMaterializers,
        }),
      })

      const adapter = makeAdapter({
        storage: { type: 'in-memory' },
        clientId: testClientId,
      })
      const store = yield* createStore({
        schema: messageSchema,
        adapter,
        storeId: 'test',
      })

      store.commit(messageEvents.messageCreated({ id: 'msg1', content: 'Hello world' }))

      const messages = store.query(messageTable)

      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        id: 'msg1',
        content: 'Hello world',
        createdBy: testClientId,
      })
    }).pipe(Vitest.withTestCtx(test)),
  )
})
