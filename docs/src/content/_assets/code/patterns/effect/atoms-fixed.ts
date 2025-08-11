// @errors: 2349 2739
// atoms.ts - Complete working example

import { makePersistedAdapter } from '@livestore/adapter-web'
import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Define events
const events = {
  userCreated: Events.clientOnly({
    name: 'userCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
    }),
  }),
}

// Define state tables
const tables = {
  users: State.SQLite.table({
    name: 'users',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      email: State.SQLite.text(),
      isActive: State.SQLite.boolean(),
      createdAt: State.SQLite.datetime(),
    },
  }),
}

// Define materializers
const materializers = State.SQLite.materializers(events, {
  userCreated: ({ id, name, email }) =>
    tables.users.insert({ id, name, email, isActive: true, createdAt: new Date() }),
})

// Create state
const state = State.SQLite.makeState({ tables, materializers })

// Create your store schema
export const schema = makeSchema({ events, state })

// Worker constructors
declare const LiveStoreWorker: (options: { name: string }) => Worker
declare const LiveStoreSharedWorker: (options: { name: string }) => SharedWorker

// Create a persistent adapter with OPFS storage
const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

// Import AtomLivestore and React dependencies
// @ts-ignore - These packages will be installed by the user
import { AtomLivestore } from '@effect-atom/atom-livestore'
// @ts-ignore - These packages will be installed by the user
import { unstable_batchedUpdates } from 'react-dom'

// Define the store as a service tag
export class StoreTag extends AtomLivestore.Tag<StoreTag>()('StoreTag', {
  schema,
  storeId: 'default',
  adapter,
  batchUpdates: unstable_batchedUpdates, // React batching for performance
}) {}

// The StoreTag class provides these static methods:
// - StoreTag.runtime - Access to Effect runtime
// - StoreTag.commit - Commit events to the store
// - StoreTag.store - Access store with Effect
// - StoreTag.storeUnsafe - Direct store access when store is already loaded
// - StoreTag.makeQuery - Create query atoms with Effect
// - StoreTag.makeQueryUnsafe - Create query atoms without Effect