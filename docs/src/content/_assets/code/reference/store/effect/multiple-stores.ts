import { makeAdapter } from '@livestore/adapter-node'
import { Store } from '@livestore/livestore/effect'
import { Effect, Layer } from 'effect'

import { schema as mainSchema } from './schema.ts'

// For demonstration, we'll use the same schema for both stores
const settingsSchema = mainSchema

// ---cut---
// Define multiple typed store contexts
const MainStore = Store.Tag(mainSchema, 'main')
const SettingsStore = Store.Tag(settingsSchema, 'settings')

// Each store has its own layer
const adapter = makeAdapter({ storage: { type: 'fs' } })

const MainStoreLayer = MainStore.layer({ adapter, batchUpdates: (cb) => cb() })
const SettingsStoreLayer = SettingsStore.layer({ adapter, batchUpdates: (cb) => cb() })

// Compose layers together
const _AllStoresLayer = Layer.mergeAll(MainStoreLayer, SettingsStoreLayer)

// Both stores available in Effect code
const _program = Effect.gen(function* () {
  const { store: mainStore } = yield* MainStore
  const { store: settingsStore } = yield* SettingsStore

  // Each store is independently typed
  return { mainStore, settingsStore }
})
