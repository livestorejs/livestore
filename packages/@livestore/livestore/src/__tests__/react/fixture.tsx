import type * as otel from '@opentelemetry/api'
import React from 'react'
import initSqlite3Wasm from 'sqlite-esm'

import { globalDbGraph } from '../../global-state.js'
import type { LiveStoreContext } from '../../index.js'
import { createStore, DbSchema, makeCudMutations, makeDbGraph, makeSchema, ParseUtils, sql } from '../../index.js'
import * as LiveStoreReact from '../../react/index.js'
import { InMemoryStorage } from '../../storage/in-memory/index.js'

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

export const tables = { todos, app }
export const schema = makeSchema({ tables })

export const parseTodos = ParseUtils.many(todos)

export const makeTodoMvc = async ({
  otelTracer,
  otelContext,
  useGlobalDbGraph = true,
}: {
  otelTracer?: otel.Tracer
  otelContext?: otel.Context
  useGlobalDbGraph?: boolean
} = {}) => {
  const AppComponentSchema = DbSchema.table('UserInfo', {
    username: DbSchema.text({ default: '' }),
  })

  const sqlite3 = await initSqlite3Wasm({
    print: (message) => console.log(`[livestore sqlite] ${message}`),
    printErr: (message) => console.error(`[livestore sqlite] ${message}`),
  })

  const dbGraph = useGlobalDbGraph ? globalDbGraph : makeDbGraph()

  const store = await createStore({
    schema,
    loadStorage: () => InMemoryStorage.load(),
    boot: (db) => db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');`),
    sqlite3,
    dbGraph,
    otelTracer,
    otelRootSpanContext: otelContext,
  })

  const cud = makeCudMutations(tables)

  // TODO improve typing of `LiveStoreContext`
  const storeContext: LiveStoreContext = { store } as TODO

  const wrapper = ({ children }: any) => (
    <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>{children}</LiveStoreReact.LiveStoreContext.Provider>
  )

  return { wrapper, AppComponentSchema, store, dbGraph, cud }
}
