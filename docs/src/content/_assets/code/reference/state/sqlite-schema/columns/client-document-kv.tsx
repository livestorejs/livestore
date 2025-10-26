import { Schema, State, type Store } from '@livestore/livestore'
import { useClientDocument } from '@livestore/react'
import type React from 'react'

export const kv = State.SQLite.clientDocument({
  name: 'Kv',
  schema: Schema.Any,
  default: { value: null },
})

export const readKvValue = (store: Store, id: string): unknown => store.query(kv.get(id))

export const setKvValue = (store: Store, id: string, value: unknown): void => {
  store.commit(kv.set(value, id))
}

export const KvViewer: React.FC<{ id: string }> = ({ id }) => {
  const [value, setValue] = useClientDocument(kv, id)

  return (
    <button type="button" onClick={() => setValue('hello')}>
      Current value: {JSON.stringify(value)}
    </button>
  )
}
