import type { Store } from '@livestore/livestore'
import { querySQL, rowQuery, SessionIdSymbol, sql } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { LiveList } from '@livestore/react/experimental'
import { Schema } from 'effect'
import React from 'react'

import { mutations, tables, type Todo } from '../schema/index.js'

// Define the reactive queries for this component

// First, we create a reactive query which defines the filter clause for the SQL query.
// It gets all the rows from the app table, and pipes them into a transform function.
// The result is a reactive query whose value is a string containing the filter clause.
// TODO make sure row exists before querying
const filterClause$ = rowQuery(tables.app, SessionIdSymbol, {
  map: ({ filter }) => `where ${filter === 'all' ? '' : `completed = ${filter === 'completed'} and `}deleted is null`,
  label: 'filterClause',
})

// Next, we create the actual query for the visible todos.
// We create a new reactive SQL query which interpolates the filterClause.
// Notice how we call filterClause() as a function--
// that gets the latest value of that reactive query.
const visibleTodos$ = querySQL((get) => sql`select * from todos ${get(filterClause$)}`, {
  schema: Schema.Array(tables.todos.schema),
  label: 'visibleTodos',
})

export const MainSection: React.FC = () => {
  const { store } = useStore()

  // We record an event that specifies marking complete or incomplete,
  // The reason is that this better captures the user's intention
  // when the event gets synced across multiple devices--
  // If another user toggled concurrently, we shouldn't toggle it back
  const toggleTodo = React.useCallback(
    (todo: Todo) =>
      store.mutate(
        todo.completed ? mutations.uncompleteTodo({ id: todo.id }) : mutations.completeTodo({ id: todo.id }),
      ),
    [store],
  )

  const getKey = React.useCallback((todo: Todo): string => todo.id, [])
  const renderItem = React.useCallback(
    (todo: Todo, { isInitialListRender }: { index: number; isInitialListRender: boolean }) => (
      <Item todo={todo} parentHasMounted={!isInitialListRender} store={store} toggleTodo={toggleTodo} />
    ),
    [store, toggleTodo],
  )

  return (
    <section className="main">
      <ul className="todo-list">
        <LiveList items$={visibleTodos$} getKey={getKey} renderItem={renderItem} />
      </ul>
    </section>
  )
}

const Item = ({
  todo,
  toggleTodo,
  store,
  parentHasMounted,
}: {
  todo: Todo
  toggleTodo: (_: Todo) => void
  store: Store
  parentHasMounted: boolean
}) => {
  const [state, setState] = React.useState<'initial' | 'deleting' | 'mounted'>('initial')
  const isDeletedRef = React.useRef(false)

  React.useEffect(() => setState('mounted'), [])
  const isZero = parentHasMounted && (state === 'initial' || state === 'deleting')

  return (
    <li
      style={{ opacity: isZero ? 0 : 1, height: isZero ? 0 : 58, transition: 'all 0.2s ease-in-out' }}
      onTransitionEnd={() => {
        // NOTE to avoid triggering a delete twice, we need to check if the todo has been deleted via the ref
        // Since using the `setState` doesn't seem to happen "quickly enough"
        if (state === 'deleting' && todo.deleted === null && !isDeletedRef.current) {
          store.mutate(mutations.deleteTodo({ id: todo.id, deleted: Date.now() }))
          isDeletedRef.current = true
        }
      }}
    >
      <div className="view">
        <input type="checkbox" className="toggle" checked={todo.completed} onChange={() => toggleTodo(todo)} />
        <label>{todo.text}</label>
        <button className="destroy" onClick={() => setState('deleting')}></button>
      </div>
    </li>
  )
}
