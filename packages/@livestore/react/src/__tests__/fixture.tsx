import { provideOtel } from '@livestore/common'
import { DbSchema, makeSchema } from '@livestore/common/schema'
import type { LiveStoreContextRunning } from '@livestore/livestore'
import { createStore } from '@livestore/livestore'
import { Effect } from '@livestore/utils/effect'
import { makeInMemoryAdapter } from '@livestore/web'
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

export const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
  },
  { deriveMutations: true, isSingleton: false },
)

export const app = DbSchema.table(
  'app',
  {
    id: DbSchema.text({ primaryKey: true, default: 'static' }),
    newTodoText: DbSchema.text({ default: '', nullable: true }),
    filter: DbSchema.text({ default: 'all', nullable: false }),
  },
  { isSingleton: true },
)

export const userInfo = DbSchema.table(
  'UserInfo',
  {
    username: DbSchema.text({ default: '' }),
    text: DbSchema.text({ default: '' }),
  },
  { deriveMutations: true },
)

export const AppRouterSchema = DbSchema.table(
  'AppRouter',
  {
    currentTaskId: DbSchema.text({ default: null, nullable: true }),
  },
  { isSingleton: true, deriveMutations: true },
)

export const tables = { todos, app, userInfo, AppRouterSchema }
export const schema = makeSchema({ tables })

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

    const store = yield* createStore({
      schema,
      storeId: 'default',
      adapter: makeInMemoryAdapter(),
      debug: { instanceId: 'test' },
    })

    // TODO improve typing of `LiveStoreContext`
    const storeContext = { stage: 'running', store } as any as LiveStoreContextRunning

    const MaybeStrictMode = strictMode ? React.StrictMode : React.Fragment

    const wrapper = ({ children }: any) => (
      <MaybeStrictMode>
        <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>
          {children}
        </LiveStoreReact.LiveStoreContext.Provider>
      </MaybeStrictMode>
    )

    const renderCount = makeRenderCount()

    return { wrapper, store, renderCount }
  }).pipe(provideOtel({ parentSpanContext: otelContext, otelTracer }))
