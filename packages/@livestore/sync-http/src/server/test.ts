import { startSyncProvider } from './node.ts'

startSyncProvider({
  storage: { kind: 'memory' },
})
