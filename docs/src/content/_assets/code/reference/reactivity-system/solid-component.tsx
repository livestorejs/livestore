import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import { tables } from '../solid-integration/livestore/schema.ts'

const todos$ = queryDb(tables.todos.where({ deletedAt: null }), { label: 'todos' })

export const TodoList = () => {
  const todos = query(todos$, [])

  return <div>{todos().length} items</div>
}
