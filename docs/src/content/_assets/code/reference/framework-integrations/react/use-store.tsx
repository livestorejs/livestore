import type { FC } from 'react'
import { useEffect } from 'react'

import { events } from './schema.ts'
import { useAppStore } from './store.ts'

export const MyComponent: FC = () => {
  const store = useAppStore()

  useEffect(() => {
    store.commit(events.todoCreated({ id: '1', text: 'Hello, world!' }))
  }, [store])

  return <div>...</div>
}
