import { FetchHttpClient } from '@effect/platform'
import * as Vitest from '@effect/vitest'
import { Effect, Exit } from 'effect'

import { makeWebSocket } from './WebSocket.js'

Vitest.describe('WebSocket', () => {
  Vitest.scopedLive(
    'should create a WebSocket connection',
    Effect.fn(function* () {
      const exit = yield* makeWebSocket({ url: 'ws://localhost:1000' }).pipe(Effect.timeout(500), Effect.exit)
      Vitest.expect(Exit.isFailure(exit)).toBe(true)
    }, Effect.provide(FetchHttpClient.layer)),
  )
})
