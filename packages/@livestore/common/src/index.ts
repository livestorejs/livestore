export * from './schema/system-tables.js'
export * from './util.js'
export * from './adapter-types.js'
export * from './sync/next-mutation-event-id-pair.js'
export * from './schema-management/migrations.js'
export * from './mutation.js'
export * from './init-singleton-tables.js'
export * from './rehydrate-from-mutationlog.js'
export * from './query-info.js'
export * from './derived-mutations.js'
export * from './sync/index.js'
export * as Devtools from './devtools/index.js'
export * from './debug-info.js'
export * from './bounded-collections.js'
export * from './version.js'
export * from './query-builder/mod.js'
export * from './sync/syncstate.js'

declare global {
  interface LiveStoreGlobal {
    // syncBackend: never
  }
}
