import { Effect, FiberSet, Schema as __Schema } from '@livestore/utils/effect'
import { makeInMemoryAdapter } from '@livestore/web'
import type * as otel from '@opentelemetry/api'
import React from 'react'

import { globalReactivityGraph } from '../../global-state.js'
import type { LiveStoreContext } from '../../index.js'
import { createStore, DbSchema, makeReactivityGraph, makeSchema, sql } from '../../index.js'
import * as LiveStoreReact from '../../react/index.js'

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

export const app = DbSchema.table('app', {
  id: DbSchema.text({ primaryKey: true }),
  newTodoText: DbSchema.text({ default: '', nullable: true }),
  filter: DbSchema.text({ default: 'all', nullable: false }),
})

const userInfo = DbSchema.table(
  'UserInfo',
  {
    username: DbSchema.text({ default: '' }),
    text: DbSchema.text({ default: '' }),
  },
  { deriveMutations: true },
)

const AppRouterSchema = DbSchema.table(
  'AppRouter',
  {
    currentTaskId: DbSchema.text({ default: null, nullable: true }),
  },
  { isSingleton: true, deriveMutations: true },
)

export const tables = { todos, app, userInfo, AppRouterSchema }
export const schema = makeSchema({ tables })

export const makeTodoMvc = ({
  otelTracer,
  otelContext,
  useGlobalReactivityGraph = true,
  strictMode = process.env.REACT_STRICT_MODE !== undefined,
}: {
  otelTracer?: otel.Tracer
  otelContext?: otel.Context
  useGlobalReactivityGraph?: boolean
  strictMode?: boolean
} = {}) =>
  Effect.gen(function* () {
    const reactivityGraph = useGlobalReactivityGraph ? globalReactivityGraph : makeReactivityGraph()

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

    const fiberSet = yield* FiberSet.make()

    const store = yield* createStore({
      schema,
      boot: (db) => db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');`),
      adapter: makeInMemoryAdapter(),
      reactivityGraph,
      otelOptions: {
        tracer: otelTracer,
        rootSpanContext: otelContext,
      },
      fiberSet,
    })

    // TODO improve typing of `LiveStoreContext`
    const storeContext = { stage: 'running', store } as any as LiveStoreContext

    const MaybeStrictMode = strictMode ? React.StrictMode : React.Fragment

    const wrapper = ({ children }: any) => (
      <MaybeStrictMode>
        <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>
          {children}
        </LiveStoreReact.LiveStoreContext.Provider>
      </MaybeStrictMode>
    )

    return {
      wrapper,
      AppComponentSchema: userInfo,
      AppRouterSchema,
      store,
      reactivityGraph,
      makeRenderCount,
      strictMode,
    }
  })
