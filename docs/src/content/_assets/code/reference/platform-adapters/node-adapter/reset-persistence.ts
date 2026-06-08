// ---cut---
import { makeAdapter } from '@livestore/adapter-node'

const resetPersistence = process.env.NODE_ENV !== 'production' && Boolean(process.env.RESET_LIVESTORE)

const adapter = makeAdapter({
  storage: { type: 'fs' },
  resetPersistence,
})
