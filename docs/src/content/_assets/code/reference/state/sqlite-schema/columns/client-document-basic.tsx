import React from 'react'

import type { Store } from '@livestore/livestore'

import { tables } from '../../../framework-integrations/react/schema.ts'
import { useAppStore } from '../../../framework-integrations/react/store.ts'

export const readUiState = (store: Store): { newTodoText: string; filter: 'all' | 'active' | 'completed' } =>
  store.query(tables.uiState.get())

export const setNewTodoText = (store: Store, newTodoText: string): void => {
  store.commit(tables.uiState.set({ newTodoText }))
}

export const UiStateFilter: React.FC = () => {
  const store = useAppStore()
  const [state, setState] = store.useClientDocument(tables.uiState)

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
