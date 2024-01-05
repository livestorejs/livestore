import type * as otel from '@opentelemetry/api'
import React from 'react'
import initSqlite3Wasm from 'sqlite-esm'

import { globalDbGraph } from '../../global-state.js'
import type { LiveStoreContext } from '../../index.js'
import { createStore, DbSchema, makeDbGraph, makeSchema, sql } from '../../index.js'
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

export const schema = makeSchema({
  tables: {
    todos: DbSchema.table('todos', {
      id: DbSchema.text({ primaryKey: true }),
      text: DbSchema.text({ default: '', nullable: false }),
      completed: DbSchema.boolean({ default: false, nullable: false }),
    }),
    app: DbSchema.table('app', {
      id: DbSchema.text({ primaryKey: true }),
      newTodoText: DbSchema.text({ default: '', nullable: true }),
      filter: DbSchema.text({ default: 'all', nullable: false }),
    }),
  },
  actions: {
    // TODO: fix these actions to make them have write annotatinos
    addTodo: {
      statement: {
        sql: sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false);`,
        writeTables: ['app'],
      },
    },
    completeTodo: { statement: { sql: sql`UPDATE todos SET completed = true WHERE id = $id;`, writeTables: ['app'] } },
    uncompleteTodo: {
      statement: { sql: sql`UPDATE todos SET completed = false WHERE id = $id;`, writeTables: ['app'] },
    },
    deleteTodo: { statement: { sql: sql`DELETE FROM todos WHERE id = $id;`, writeTables: ['app'] } },
    clearCompleted: { statement: { sql: sql`DELETE FROM todos WHERE completed = true;`, writeTables: ['app'] } },
    updateNewTodoText: { statement: { sql: sql`UPDATE app SET newTodoText = $text;`, writeTables: ['app'] } },
    setFilter: { statement: { sql: sql`UPDATE app SET filter = $filter;`, writeTables: ['app'] } },
  },
})

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

  const storeContext: LiveStoreContext = { store }

  const wrapper = ({ children }: any) => (
    <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>{children}</LiveStoreReact.LiveStoreContext.Provider>
  )

  return { wrapper, AppComponentSchema, store, dbGraph }
}
