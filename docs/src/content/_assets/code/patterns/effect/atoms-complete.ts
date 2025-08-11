// atoms.ts - Complete working example

import { makePersistedAdapter } from '@livestore/adapter-web'
import { makeSchema, Schema } from '@livestore/livestore'

// Create your store schema
export const schema = makeSchema({
  events: {
    userCreated: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
    }),
    itemCreated: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    }),
    itemUpdated: Schema.Struct({
      id: Schema.String,
      status: Schema.String,
    }),
  },
  tables: {
    users: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      isActive: Schema.Boolean,
      createdAt: Schema.DateTimeUtc,
    }),
    todos: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
      createdAt: Schema.DateTimeUtc,
    }),
    products: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.String,
      price: Schema.Number,
      createdAt: Schema.DateTimeUtc,
    }),
  },
})

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
