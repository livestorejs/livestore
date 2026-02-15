import { queryDb } from '@livestore/livestore'
import { type Component, createMemo } from 'solid-js'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

export const Footer: Component = () => {
  const store = useAppStore()
  const uiState = store.useQuery(uiState$)
  const incompleteCount = store.useQuery(incompleteCount$)

  const setFilter = (filter: (typeof tables.uiState.Value)['filter']) => store()?.commit(events.uiStateSet({ filter }))

  const handleFilterClick = createMemo(() => (event: MouseEvent & { currentTarget: HTMLAnchorElement }) => {
    const nextFilter = event.currentTarget.dataset.filter as (typeof tables.uiState.Value)['filter'] | undefined
    if (nextFilter) {
      setFilter(nextFilter)
    }
  })

  const handleClearCompleted = createMemo(() => () => {
    store()?.commit(events.todoClearedCompleted({ deletedAt: new Date() }))
  })

  return (
    <footer class="footer">
      <span class="todo-count">{incompleteCount() ?? 0} items left</span>
      <ul class="filters">
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a
            href="#/"
            class={uiState()?.filter === 'all' ? 'selected' : undefined}
            data-filter="all"
            onClick={handleFilterClick()}
          >
            All
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a
            href="#/"
            class={uiState()?.filter === 'active' ? 'selected' : undefined}
            data-filter="active"
            onClick={handleFilterClick()}
          >
            Active
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a
            href="#/"
            class={uiState()?.filter === 'completed' ? 'selected' : undefined}
            data-filter="completed"
            onClick={handleFilterClick()}
          >
            Completed
          </a>
        </li>
      </ul>
      <button type="button" class="clear-completed" onClick={handleClearCompleted()}>
        Clear completed
      </button>
    </footer>
  )
}
