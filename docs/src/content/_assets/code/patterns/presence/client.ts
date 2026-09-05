import { makePresenceClient } from '@livestore/sync-cf/presence/client'
import { Effect } from '@livestore/utils/effect'

import { presenceSchemas } from './schemas.ts'

export const program = Effect.gen(function* () {
  const presence = yield* makePresenceClient({
    url: 'https://example.com/sync',
    storeId: 'my-store',
    clientId: 'client-1',
    payload: { authToken: 'token' },
    channels: presenceSchemas,
  })

  yield* presence.setState('cursor', { x: 12, y: 40 })
})
