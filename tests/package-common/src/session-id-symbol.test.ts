import { expect } from 'vitest'

import { makeAdapter } from '@livestore/adapter-node'
import { makeSchema, State } from '@livestore/common/schema'
import { createStore, SessionIdSymbol } from '@livestore/livestore'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Schema } from '@livestore/utils/effect'

Vitest.describe('SessionIdSymbol', () => {
  Vitest.scopedLive('encodes commit events without mutating caller-provided args', (test) =>
    Effect.gen(function* () {
      const uiState = State.SQLite.clientDocument({
        name: 'UiState',
        schema: Schema.Struct({
          draft: Schema.String,
        }),
        default: {
          id: SessionIdSymbol,
          value: { draft: '' },
        },
      })

      const store = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { uiState }, materializers: {} }),
          events: { UiStateSet: uiState.set },
        }),
        adapter: makeAdapter({ storage: { type: 'in-memory' }, sessionId: 'test-session' }),
        storeId: 'session-id-symbol-test',
      })

      const event = uiState.set({ draft: 'hello' })

      store.commit(event)

      expect((event.args as { id: unknown }).id).toBe(SessionIdSymbol)
      expect(store.query(uiState.get())).toEqual({ draft: 'hello' })
      expect(
        store.query({ query: `SELECT id FROM 'UiState'`, bindValues: [] }) as ReadonlyArray<{ id: string }>,
      ).toEqual([{ id: store.sessionId }])
    }).pipe(Vitest.withTestCtx(test)),
  )
})
