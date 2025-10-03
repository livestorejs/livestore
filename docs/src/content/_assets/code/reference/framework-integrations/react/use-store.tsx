import { useStore } from '@livestore/react'
import type { FC } from 'react'
import { useEffect } from 'react'

import { events } from './schema.ts'

export const MyComponent: FC = () => {
  const { store } = useStore()

  useEffect(() => {
    store.commit(events.todoCreated({ id: '1', text: 'Hello, world!' }))
  }, [store])

  return <div>...</div>
}
