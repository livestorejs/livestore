import { expect } from 'vitest'

import { makeSchema, State } from '@livestore/common/schema'
import { createStore, SessionIdSymbol, StoreInternalsSymbol } from '@livestore/livestore'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Schema } from '@livestore/utils/effect'

import { makeTestAdapter } from './test-adapter.ts'

/** Verifies: LS.SYS.STATE.SQLITE-R03, LS.SYS.STATE.SQLITE-R07 */
Vitest.describe('Client Document Optimistic Decoding Integration', () => {
  Vitest.live('handles schema evolution gracefully', (test) =>
    Effect.gen(function* () {
      // V1: Initial schema
      const v1Doc = State.SQLite.clientDocument({
        name: 'Settings',
        schema: Schema.Struct({ theme: Schema.String }),
        default: { id: SessionIdSymbol, value: { theme: 'light' } },
      })

      // Create and populate with V1
      const adapter1 = makeTestAdapter()
      const store1 = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { settings: v1Doc }, materializers: {} }),
          events: { SettingsSet: v1Doc.set },
        }),
        adapter: adapter1,
        storeId: 'test',
      })

      store1.commit(v1Doc.set({ theme: 'dark' }))
      const snapshot = store1[StoreInternalsSymbol].sqliteDbWrapper.export()

      // V2: Add required field
      const v2Doc = State.SQLite.clientDocument({
        name: 'Settings',
        schema: Schema.Struct({
          theme: Schema.String,
          fontSize: Schema.Number,
        }),
        default: { id: SessionIdSymbol, value: { theme: 'light', fontSize: 14 } },
      })

      // Reopen with V2 - should handle gracefully
      const adapter2 = makeTestAdapter({ importSnapshot: snapshot })
      const store2 = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { settings: v2Doc }, materializers: {} }),
          events: {},
        }),
        adapter: adapter2,
        storeId: 'test',
      })

      const result = store2.query(v2Doc.get())
      expect(result.theme).toBe('dark') // Preserved
      expect(result.fontSize).toBe(14) // From default
    }).pipe(Vitest.withTestCtx(test)),
  )

  Vitest.live('handles field removal', (test) =>
    Effect.gen(function* () {
      // V1: Has apiKey field
      const v1Doc = State.SQLite.clientDocument({
        name: 'Config',
        schema: Schema.Struct({
          apiUrl: Schema.String,
          apiKey: Schema.String,
        }),
        default: { id: SessionIdSymbol, value: { apiUrl: 'https://api.example.com', apiKey: 'secret' } },
      })

      const adapter1 = makeTestAdapter()
      const store1 = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { config: v1Doc }, materializers: {} }),
          events: { ConfigSet: v1Doc.set },
        }),
        adapter: adapter1,
        storeId: 'test-removal',
      })

      store1.commit(v1Doc.set({ apiUrl: 'https://prod.api.com', apiKey: 'prod-key' }))
      const snapshot = store1[StoreInternalsSymbol].sqliteDbWrapper.export()

      // V2: Remove apiKey field
      const v2Doc = State.SQLite.clientDocument({
        name: 'Config',
        schema: Schema.Struct({ apiUrl: Schema.String }),
        default: { id: SessionIdSymbol, value: { apiUrl: 'https://api.example.com' } },
      })

      const adapter2 = makeTestAdapter({ importSnapshot: snapshot })
      const store2 = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { config: v2Doc }, materializers: {} }),
          events: { ConfigSet: v2Doc.set },
        }),
        adapter: adapter2,
        storeId: 'test-removal',
      })

      const result = store2.query(v2Doc.get())
      expect(result.apiUrl).toBe('https://prod.api.com') // Preserved
      expect('apiKey' in result).toBe(false) // Removed
    }).pipe(Vitest.withTestCtx(test)),
  )
})
