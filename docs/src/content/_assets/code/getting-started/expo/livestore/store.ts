import { unstable_batchedUpdates as batchUpdates } from 'react-native'

import { makePersistedAdapter } from '@livestore/adapter-expo'
import { useStore } from '@livestore/react'
import { makeWsSync } from '@livestore/sync-cf/client'

import { events, schema, tables } from './schema.ts'

const syncUrl = 'https://example.org/sync'

const adapter = makePersistedAdapter({
  sync: { backend: makeWsSync({ url: syncUrl }) },
})

export const useAppStore = () =>
  useStore({
    storeId: 'expo-todomvc',
    schema,
    adapter,
    batchUpdates,
    boot: (store) => {
      if (store.query(tables.todos.count()) === 0) {
        store.commit(events.todoCreated({ id: crypto.randomUUID(), text: 'Make coffee' }))
      }
    },
  })
