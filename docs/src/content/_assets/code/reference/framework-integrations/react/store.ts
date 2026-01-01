import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { schema } from './schema.ts'

const adapter = makeInMemoryAdapter()

export const useAppStore = () =>
  useStore({
    storeId: 'app-root',
    schema,
    adapter,
    batchUpdates,
  })
