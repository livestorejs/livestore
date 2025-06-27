import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { provideOtel } from '@livestore/common'
import { Events, makeSchema, State } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import { createStore } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import React from 'react'

import * as LiveStoreReact from '../mod.js'

export type Todo = {
  id: string
  text: string
  completed: boolean
}

export type Filter = 'all' | 'active' | 'completed'

export type AppState = {
  newTodoText: string
  filter: Filter
}

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
  },
})

const app = State.SQLite.table({
  name: 'app',
  columns: {
    id: State.SQLite.text({ primaryKey: true, default: 'static' }),
    newTodoText: State.SQLite.text({ default: '', nullable: true }),
    filter: State.SQLite.text({ default: 'all', nullable: false }),
  },
})

const userInfo = State.SQLite.clientDocument({
  name: 'UserInfo',
  schema: Schema.Struct({
    username: Schema.String,
    text: Schema.String,
  }),
  default: { value: { username: '', text: '' } },
})

const AppRouterSchema = State.SQLite.clientDocument({
  name: 'AppRouter',
  schema: Schema.Struct({
    currentTaskId: Schema.String.pipe(Schema.NullOr),
  }),
  default: {
    value: { currentTaskId: null },
    id: 'singleton',
  },
})

export const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean }),
  }),
  todoUpdated: Events.synced({
    name: 'todoUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String.pipe(Schema.optional),
      completed: Schema.Boolean.pipe(Schema.optional),
    }),
  }),
  AppRouterSet: AppRouterSchema.set,
  UserInfoSet: userInfo.set,
}

const materializers: State.SQLite.Materializers<typeof events> = {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed }),
  todoUpdated: ({ id, text, completed }) => todos.update({ completed, text }).where({ id }),
}

export const tables = { todos, app, userInfo, AppRouterSchema }

const state = State.SQLite.makeState({ tables, materializers })
export const schema = makeSchema({ state, events })

export const makeTodoMvcReact = ({
  otelTracer,
  otelContext,
  strictMode,
}: {
  otelTracer?: otel.Tracer
  otelContext?: otel.Context
  strictMode?: boolean
} = {}) =>
  Effect.gen(function* () {
    const makeRenderCount = () => {
      let val = 0

      const inc = () => {
        val += strictMode ? 0.5 : 1
      }

      return {
        get val() {
          return val
        },
        inc,
      }
    }

    const store: Store<any> = yield* createStore({
      schema,
      storeId: 'default',
      adapter: makeInMemoryAdapter(),
      debug: { instanceId: 'test' },
    })

    const storeWithReactApi = LiveStoreReact.withReactApi(store)

    // TODO improve typing of `LiveStoreContext`
    const storeContext = {
      stage: 'running' as const,
      store: storeWithReactApi,
    }

    const MaybeStrictMode = strictMode ? React.StrictMode : React.Fragment

    const wrapper = ({ children }: any) => (
      <MaybeStrictMode>
        <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>
          {children}
        </LiveStoreReact.LiveStoreContext.Provider>
      </MaybeStrictMode>
    )

    const renderCount = makeRenderCount()

    return { wrapper, store: storeWithReactApi, renderCount }
  }).pipe(provideOtel({ parentSpanContext: otelContext, otelTracer }))
