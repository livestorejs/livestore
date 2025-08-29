import { makeAdapter } from '@livestore/adapter-node'
import { makeSchema, State } from '@livestore/common/schema'
import { createStore, SessionIdSymbol } from '@livestore/livestore'
import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

Vitest.describe('Client Document Optimistic Decoding Integration', () => {
  const getTmpDbDir = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.makeTempDirectoryScoped()
  })

  const withTestCtx = Vitest.makeWithTestCtx({
    makeLayer: () => PlatformNode.NodeFileSystem.layer,
  })

  Vitest.scopedLive('handles schema evolution gracefully', (test) =>
    Effect.gen(function* () {
      const tmpDir = yield* getTmpDbDir

      // V1: Initial schema
      const v1Doc = State.SQLite.clientDocument({
        name: 'Settings',
        schema: Schema.Struct({ theme: Schema.String }),
        default: { id: SessionIdSymbol, value: { theme: 'light' } },
      })

      // Create and populate with V1
      const adapter1 = makeAdapter({ storage: { type: 'fs', baseDirectory: tmpDir } })
      const store1 = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { settings: v1Doc }, materializers: {} }),
          events: { SettingsSet: v1Doc.set },
        }),
        adapter: adapter1,
        storeId: 'test',
      })

      store1.commit(v1Doc.set({ theme: 'dark' }))

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
      const adapter2 = makeAdapter({ storage: { type: 'fs', baseDirectory: tmpDir } })
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
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('handles field removal', (test) =>
    Effect.gen(function* () {
      const tmpDir = yield* getTmpDbDir

      // V1: Has apiKey field
      const v1Doc = State.SQLite.clientDocument({
        name: 'Config',
        schema: Schema.Struct({
          apiUrl: Schema.String,
          apiKey: Schema.String,
        }),
        default: { id: SessionIdSymbol, value: { apiUrl: 'https://api.example.com', apiKey: 'secret' } },
      })

      const adapter1 = makeAdapter({ storage: { type: 'fs', baseDirectory: tmpDir } })
      const store1 = yield* createStore({
        schema: makeSchema({
          state: State.SQLite.makeState({ tables: { config: v1Doc }, materializers: {} }),
          events: { ConfigSet: v1Doc.set },
        }),
        adapter: adapter1,
        storeId: 'test-removal',
      })

      store1.commit(v1Doc.set({ apiUrl: 'https://prod.api.com', apiKey: 'prod-key' }))

      // V2: Remove apiKey field
      const v2Doc = State.SQLite.clientDocument({
        name: 'Config',
        schema: Schema.Struct({ apiUrl: Schema.String }),
        default: { id: SessionIdSymbol, value: { apiUrl: 'https://api.example.com' } },
      })

      const adapter2 = makeAdapter({ storage: { type: 'fs', baseDirectory: tmpDir } })
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
    }).pipe(withTestCtx(test)),
  )
})
