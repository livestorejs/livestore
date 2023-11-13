import type * as otel from '@opentelemetry/api'
import React from 'react'
import initSqlite3Wasm from 'sqlite-esm'

import * as LiveStore from '../../index.js'
import { sql } from '../../index.js'
import * as LiveStoreReact from '../../react/index.js'
import { InMemoryStorage } from '../../storage/in-memory/index.js'

export type Todo = {
  id: string
  text: string | null
  completed: boolean
}

export type Filter = 'all' | 'active' | 'completed'

export type AppState = {
  newTodoText: string
  filter: Filter
}

export const schema = LiveStore.makeSchema({
  tables: {
    todos: LiveStore.DbSchema.table('todos', {
      id: LiveStore.DbSchema.text({ primaryKey: true }),
      text: LiveStore.DbSchema.text({ default: '', nullable: false }),
      completed: LiveStore.DbSchema.boolean({ default: false, nullable: false }),
    }),
    app: LiveStore.DbSchema.table('app', {
      id: LiveStore.DbSchema.text({ primaryKey: true }),
      newTodoText: LiveStore.DbSchema.text({ default: '', nullable: true }),
      filter: LiveStore.DbSchema.text({ default: 'all', nullable: false }),
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
}: {
  otelTracer?: otel.Tracer
  otelContext?: otel.Context
} = {}) => {
  const AppSchema = LiveStore.defineComponentStateSchema('UserInfo', {
    username: LiveStore.DbSchema.text({ default: '' }),
  })

  const sqlite3 = await initSqlite3Wasm({
    print: (message) => console.log(`[livestore sqlite] ${message}`),
    printErr: (message) => console.error(`[livestore sqlite] ${message}`),
  })

  const store = await LiveStore.createStore({
    schema,
    loadStorage: () => InMemoryStorage.load(),
    boot: (db) => db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');`),
    sqlite3,
    otelTracer,
    otelRootSpanContext: otelContext,
  })

  const storeContext: LiveStore.LiveStoreContext = { store }

  const wrapper = ({ children }: any) => (
    <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>{children}</LiveStoreReact.LiveStoreContext.Provider>
  )

  return { wrapper, AppSchema, store }
}
