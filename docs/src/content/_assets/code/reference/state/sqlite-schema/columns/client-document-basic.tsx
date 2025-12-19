import { Schema, SessionIdSymbol, State, type Store } from '@livestore/livestore'
import React from 'react'
import { useAppStore } from '../../../framework-integrations/react/store.ts'

export const uiState = State.SQLite.clientDocument({
  name: 'UiState',
  schema: Schema.Struct({
    newTodoText: Schema.String,
    filter: Schema.Literal('all', 'active', 'completed'),
  }),
  default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all' } },
})

export const readUiState = (store: Store): { newTodoText: string; filter: 'all' | 'active' | 'completed' } =>
  store.query(uiState.get())

export const setNewTodoText = (store: Store, newTodoText: string): void => {
  store.commit(uiState.set({ newTodoText }))
}

export const UiStateFilter: React.FC = () => {
  const store = useAppStore()
  const [state, setState] = store.useClientDocument(uiState)

  const showActive = React.useCallback(() => {
    setState({ filter: 'active' })
  }, [setState])

  const showAll = React.useCallback(() => {
    setState({ filter: 'all' })
  }, [setState])

  return (
    <div>
      <button type="button" onClick={showAll}>
        All
      </button>
      <button type="button" onClick={showActive}>
        Active ({state.filter === 'active' ? 'selected' : 'select'})
      </button>
    </div>
  )
}
