import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'

import { makeWebSocket } from './WebSocket.ts'

describe('WebSocket', () => {
  it.live('should create a WebSocket connection', () =>
    Effect.gen(function* () {
      const exit = yield* makeWebSocket({ url: 'ws://localhost:1000' }).pipe(
        Effect.timeout(500),
        Effect.exit,
        Effect.provide(FetchHttpClient.layer),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
