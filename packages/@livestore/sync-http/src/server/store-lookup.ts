import type { SqlClient } from '@effect/sql'
import * as PgClient from '@effect/sql-pg/PgClient'
import { Context, Effect, Layer, LayerMap, Path, PubSub, Stream } from '@livestore/utils/effect'
import {
  CurrentStoreId,
  type EventStorage,
  EventStorageSql,
  EventsStorageMemory,
  StoreTableName,
} from './event-storage.ts'

/**
 * A service representing the database configuration.
 */
export class StorageConfig extends Context.Tag('@livestore/sync-http/server/store-lookup/StorageConfig')<
  StorageConfig,
  MemoryConfig | SqliteConfig | PostgresConfig
>() {}

/**
 * Configuration for a in-memory database.
 */
export interface MemoryConfig {
  readonly kind: 'memory'
}

/**
 * Configuration for a Sqlite database.
 *
 * A database file is created per store in the specified directory.
 */
export interface SqliteConfig {
  readonly kind: 'sqlite'
  readonly directory: string
}

/**
 * Configuration for a Postgres database.
 */
export interface PostgresConfig extends PgClient.PgClientConfig {
  readonly kind: 'postgres'
}

/**
 * Sqlite client provider
 */
export class PlatformSqlite extends Context.Tag('@livestore/sync-http/server/PlatformSqlite')<
  PlatformSqlite,
  (databaseFilePath: string) => Layer.Layer<SqlClient.SqlClient>
>() {}

/**
 * A service representing pub/sub for a specific store.
 */
export class StorePubSub extends Context.Tag('@livestore/sync-http/server/StorePubSub')<
  StorePubSub,
  {
    readonly publish: (latestSequence: number) => Effect.Effect<void>
    readonly subscribe: Stream.Stream<number>
  }
>() {}

export const StorePubSubPg = Layer.effect(
  StorePubSub,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient
    const table = yield* StoreTableName

    return StorePubSub.of({
      publish: (latestSeq) => Effect.orDie(sql.notify(table.name, String(latestSeq))),
      subscribe: sql.listen(table.name).pipe(
        Stream.map((msg) => Number(msg)),
        Stream.orDie,
      ),
    })
  }),
)

export const StorePubSubMemory = Layer.effect(
  StorePubSub,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<number>()

    return StorePubSub.of({
      publish: (latestSeq) => PubSub.publish(pubsub, latestSeq),
      subscribe: Stream.fromPubSub(pubsub),
    })
  }),
)

/**
 * A service for looking up services for an individual store.
 */
export class StoreLookup extends LayerMap.Service<StoreLookup>()('@livestore/sync-http/server/StoreLookup', {
  lookup: (
    storeId: string,
  ): Layer.Layer<StorePubSub | EventStorage | CurrentStoreId, never, Path.Path | StorageConfig | PlatformSqlite> =>
    Effect.gen(function* () {
      const config = yield* StorageConfig
      const storeIdHash = yield* sha256Digest(storeId)
      switch (config.kind) {
        case 'memory': {
          return Layer.fresh(EventsStorageMemory).pipe(Layer.merge(Layer.fresh(StorePubSubMemory)))
        }
        case 'sqlite': {
          const platformSqlite = yield* PlatformSqlite
          const path = yield* Path.Path
          const databaseFilePath = path.join(path.resolve(config.directory), `${storeIdHash}.sqlite`)
          return Layer.fresh(EventStorageSql).pipe(
            Layer.provide(platformSqlite(databaseFilePath)),
            Layer.provide(StoreTableName.fromHash(storeIdHash)),
            Layer.merge(Layer.fresh(StorePubSubMemory)),
          )
        }
        case 'postgres': {
          // Try to reuse existing Postgres client layers for the same config
          let clientLayer = postgresLayers.get(config)
          if (!clientLayer) {
            clientLayer = Layer.orDie(PgClient.layer(config))
            postgresLayers.set(config, clientLayer)
          }
          return Layer.fresh(EventStorageSql).pipe(
            Layer.provideMerge(Layer.fresh(StorePubSubPg)),
            Layer.provide(clientLayer),
            Layer.provide(StoreTableName.fromHash(storeIdHash)),
          )
        }
      }
    }).pipe(Layer.unwrapEffect, Layer.provideMerge(Layer.succeed(CurrentStoreId, storeId))),
  idleTimeToLive: '1 minute',
}) {}

const postgresLayers = new WeakMap<PostgresConfig, Layer.Layer<PgClient.PgClient | SqlClient.SqlClient>>()

const sha256Digest = (str: string) =>
  Effect.promise(() =>
    crypto.subtle.digest('SHA-1', new TextEncoder().encode(str)).then((buf) => {
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }),
  )
