import { makeAdapter } from '@livestore/adapter-node'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { createStore } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import { Effect, FetchHttpClient, Logger, LogLevel, Schema } from '@livestore/utils/effect'
import { OtelLiveDummy, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
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
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('should allow empty event payload', (test) =>
    Effect.gen(function* () {
      const adapter = makeAdapter({ storage: { type: 'in-memory' } })
      const store = yield* createStore({ schema, adapter, storeId: 'test' })
      store.commit(events.emptyEventPayload())
    }).pipe(withCtx(test)),
  )
})

const otelLayer = IS_CI ? OtelLiveDummy : OtelLiveHttp({ serviceName: 'store-test', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(IS_CI ? 60_000 : 10_000),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.provide(Logger.prettyWithThread('test-main-thread')),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      Effect.provide(otelLayer),
    )
