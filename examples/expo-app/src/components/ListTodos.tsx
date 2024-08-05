import { Schema } from '@effect/schema'
import { querySQL, sql } from '@livestore/livestore'
import { useQuery } from '@livestore/livestore/react'
import React from 'react'
import { FlatList } from 'react-native'

import { tables } from '../schema/index.ts'
import { Todo } from './Todo.tsx'

const filterClause$ = querySQL(sql`select filter from app`, {
  schema: Schema.Array(tables.app.schema.pipe(Schema.pick('filter'))).pipe(Schema.headOrElse()),
  map: ({ filter }) => (filter === 'all' ? '' : `where completed = ${filter === 'completed'}`),
})

const visibleTodos$ = querySQL((get) => sql`select * from todos ${get(filterClause$)}`, {
  schema: Schema.Array(tables.todos.schema),
})

export const ListTodos: React.FC = () => {
  const visibleTodos = useQuery(visibleTodos$)

  return (
    <FlatList
      data={visibleTodos}
      renderItem={({ item }) => <Todo {...item} />}
      keyExtractor={(item) => item.id.toString()}
      initialNumToRender={20}
      maxToRenderPerBatch={20}
    />
  )
}
