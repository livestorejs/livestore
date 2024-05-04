import { Schema as __Schema } from '@livestore/utils/effect'
import { makeDb } from '@livestore/web'
import type * as otel from '@opentelemetry/api'
import React from 'react'

import { globalDbGraph } from '../../global-state.js'
import type { LiveStoreContext } from '../../index.js'
import { createStore, DbSchema, makeCudMutations, makeDbGraph, makeSchema, ParseUtils, sql } from '../../index.js'
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

export const todos = DbSchema.table('todos', {
  id: DbSchema.text({ primaryKey: true }),
  text: DbSchema.text({ default: '', nullable: false }),
  completed: DbSchema.boolean({ default: false, nullable: false }),
})

export const app = DbSchema.table('app', {
  id: DbSchema.text({ primaryKey: true }),
  newTodoText: DbSchema.text({ default: '', nullable: true }),
  filter: DbSchema.text({ default: 'all', nullable: false }),
})

const userInfo = DbSchema.table('UserInfo', {
  username: DbSchema.text({ default: '' }),
  text: DbSchema.text({ default: '' }),
})

const AppRouterSchema = DbSchema.table(
  'AppRouter',
  {
    currentTaskId: DbSchema.text({ default: null, nullable: true }),
  },
  { isSingleton: true },
)

export const tables = { todos, app, userInfo, AppRouterSchema }
export const schema = makeSchema({ tables })

export const parseTodos = ParseUtils.many(todos)

export const makeTodoMvc = async ({
  otelTracer,
  otelContext,
  useGlobalDbGraph = true,
  strictMode = process.env.REACT_STRICT_MODE !== undefined,
}: {
  otelTracer?: otel.Tracer
  otelContext?: otel.Context
  useGlobalDbGraph?: boolean
  strictMode?: boolean
} = {}) => {
  const dbGraph = useGlobalDbGraph ? globalDbGraph : makeDbGraph()

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

  const store = await createStore({
    schema,
    boot: (db) => db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');`),
    makeDb: makeDb(),
    dbGraph,
    otelTracer,
    otelRootSpanContext: otelContext,
  })

  const cud = makeCudMutations(tables)

  // TODO improve typing of `LiveStoreContext`
  const storeContext: LiveStoreContext = { store } as TODO

  const MaybeStrictMode = strictMode ? React.StrictMode : React.Fragment

  const wrapper = ({ children }: any) => (
    <MaybeStrictMode>
      <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>
        {children}
      </LiveStoreReact.LiveStoreContext.Provider>
    </MaybeStrictMode>
  )

  return {
    [Symbol.dispose]: () => store.destroy(),
    wrapper,
    AppComponentSchema: userInfo,
    AppRouterSchema,
    store,
    dbGraph,
    cud,
    makeRenderCount,
    strictMode,
  }
}
