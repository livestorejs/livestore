import { mapObjectValues } from '@livestore/utils'
import React from 'react'

import { WebInMemoryBackend } from '../../backends/in-memory/index.js'
import * as LiveStore from '../../index.js'
import { sql } from '../../index.js'
import * as LiveStoreReact from '../../react/index.js'

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

const appState: LiveStore.QueryDefinition = (store) =>
  store.querySQL<AppState>(() => `select newTodoText, filter from app;`, { queriedTables: ['app'] }).getFirstRow()

export const globalQueryDefs = {
  appState,
}

export const schema = LiveStore.defineSchema({
  tables: {
    todos: {
      columns: {
        id: { type: 'text', primaryKey: true },
        text: { type: 'text', default: '', nullable: false },
        completed: { type: 'boolean', default: false, nullable: false },
      },
    },
    app: {
      columns: {
        id: { type: 'text', primaryKey: true },
        newTodoText: { type: 'text', default: '', nullable: true },
        filter: { type: 'text', default: 'all', nullable: false },
      },
    },
  },
  materializedViews: {},
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

export const makeTodoMvc = async () => {
  type UserInfoComponentState = { username: string }

  const AppSchema = LiveStore.defineComponentStateSchema<UserInfoComponentState>({
    componentType: 'UserInfo',
    columns: {
      username: { type: 'text', default: '' },
    },
  })

  const store = await LiveStore.createStore({
    schema,
    loadBackend: () => WebInMemoryBackend.load(),
    boot: async (backend) => {
      backend.execute(sql`INSERT INTO app (newTodoText, filter) VALUES ('', 'all');`)
      // NOTE we can't insert into components__UserInfo yet because the table doesn't exist yet
      // backend.execute(sql`INSERT INTO components__UserInfo (id, username) VALUES ('u1', 'username_u1');`)
      // backend.execute(sql`INSERT INTO components__UserInfo (id, username) VALUES ('u2', 'username_u2');`)
    },
  })

  const globalQueries = mapObjectValues(globalQueryDefs, (_, queryDef) => queryDef(store))
  const storeContext: LiveStore.LiveStoreContext = { store, globalQueries }

  const wrapper = ({ children }: any) => (
    <LiveStoreReact.LiveStoreContext.Provider value={storeContext}>{children}</LiveStoreReact.LiveStoreContext.Provider>
  )

  return { wrapper, AppSchema, store }
}
