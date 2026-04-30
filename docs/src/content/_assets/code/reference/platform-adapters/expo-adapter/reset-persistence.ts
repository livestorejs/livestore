import { makePersistedAdapter } from '@livestore/adapter-expo'

const resetPersistence = process.env.EXPO_PUBLIC_LIVESTORE_RESET === 'true'

const _adapter = makePersistedAdapter({
  storage: { subDirectory: 'dev' },
  resetPersistence,
})
