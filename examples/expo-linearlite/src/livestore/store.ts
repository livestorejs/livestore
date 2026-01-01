import { makePersistedAdapter } from '@livestore/adapter-expo'
import { nanoid } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-native'
import { events, schema, tables } from './schema.ts'

const adapter = makePersistedAdapter({})

export const useAppStore = () =>
  useStore({
    storeId: 'expo-linearlite',
    schema,
    adapter,
    batchUpdates,
    boot: (store) => {
      if (store.query(tables.users.count()) === 0) {
        store.commit(
          events.userCreated({
            id: nanoid(),
            name: 'Beto',
            email: 'beto@expo.io',
            photoUrl: 'https://avatars.githubusercontent.com/u/43630417?v=4',
          }),
        )
      }
    },
  })
