import { expect } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { createStore, SessionIdSymbol } from '@livestore/livestore'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Schema } from '@livestore/utils/effect'

/** Verifies generic session-id resolution in explicit client-only events. */
Vitest.describe('SessionIdSymbol', () => {
  Vitest.live('encodes commit events without mutating caller-provided args', (test) =>
    Effect.gen(function* () {
      const uiState = State.SQLite.table({
        name: 'UiState',
        columns: {
          id: State.SQLite.text({ primaryKey: true }),
          draft: State.SQLite.text({ default: '' }),
        },
      })
      const draftChanged = Events.clientOnly({
        name: 'DraftChanged',
        schema: Schema.Struct({
          id: Schema.Union([Schema.String, Schema.UniqueSymbol(SessionIdSymbol)]),
          draft: Schema.String,
        }),
      })
      const materializers = State.SQLite.materializers(
        { draftChanged },
        {
          DraftChanged: ({ id, draft }) => {
            // Event arguments must be concrete before reaching the state materializer.
            if (id === SessionIdSymbol) throw new Error('SessionIdSymbol was not resolved')
            return uiState.insert({ id, draft }).onConflict('id', 'update', { draft })
          },
        },
      )

      const store = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { uiState }, materializers }),
          events: { draftChanged },
        }),
        adapter: makeInMemoryAdapter({ sessionId: 'test-session' }),
        storeId: 'session-id-symbol-test',
      })

      const event = draftChanged({ id: SessionIdSymbol, draft: 'hello' })

      store.commit(event)

      expect((event.args as { id: unknown }).id).toBe(SessionIdSymbol)
      expect(store.query(uiState.where({ id: store.sessionId }).first({ behaviour: 'error' }))).toEqual({
        id: store.sessionId,
        draft: 'hello',
      })
      expect(
        store.query({ query: `SELECT id FROM 'UiState'`, bindValues: [] }) as ReadonlyArray<{ id: string }>,
      ).toEqual([{ id: store.sessionId }])
    }).pipe(Vitest.withTestCtx(test)),
  )
})
