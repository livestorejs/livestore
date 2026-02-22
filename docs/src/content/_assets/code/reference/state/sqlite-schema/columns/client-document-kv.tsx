import { type FC, useCallback } from 'react'

import { Schema, State, type Store } from '@livestore/livestore'

import { useAppStore } from '../../../framework-integrations/react/store.ts'

export const kv = State.SQLite.clientDocument({
  name: 'Kv',
  schema: Schema.Any,
  default: { value: null },
})

export const readKvValue = (store: Store, id: string): unknown => store.query(kv.get(id))

export const setKvValue = (store: Store, id: string, value: unknown): void => {
  store.commit(kv.set(value, id))
}

export const KvViewer: FC<{ id: string }> = ({ id }) => {
  const store = useAppStore()
  const [value, setValue] = store.useClientDocument(kv, id)

  const handleClick = useCallback(() => {
    setValue('hello')
  }, [setValue])

  return (
    <button type="button" onClick={handleClick}>
      Current value: {JSON.stringify(value)}
    </button>
  )
}
