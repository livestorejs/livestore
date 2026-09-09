import { makePresenceClient } from '@livestore/sync-cf/presence/client'
import { Effect } from '@livestore/utils/effect'

import { presenceSchemas } from './schemas.ts'

const conversationId = 'alice-bob'

export const program = Effect.gen(function* () {
  const presence = yield* makePresenceClient({
    url: 'https://example.com/sync',
    storeId: 'chat-app',
    clientId: 'client-1',
    payload: { authToken: 'token' },
    channels: presenceSchemas,
  })

  const chat = presence.room(`chat:${conversationId}`)
  yield* chat.setState('typing', { isTyping: true })
})
