import type { SqlClient } from '@effect/sql'
import * as PgClient from '@effect/sql-pg/PgClient'
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient'
import { Context, Effect, Layer, LayerMap, Path, PubSub, Stream } from '@livestore/utils/effect'
import { EventsRepo, StoreTableName } from './events-repo.ts'

/**
 * A service representing the database configuration.
 */
export class DatabaseConfig extends Context.Tag('@livestore/sync-http/server/store-lookup/DatabaseConfig')<
  DatabaseConfig,
  SqliteConfig | PostgresConfig
>() {}

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
 * A service representing pub/sub for a specific store.
 */
export class StorePubSub extends Context.Tag('@livestore/sync-http/server/StorePubSub')<
  StorePubSub,
  {
    readonly publish: (latestSequence: number) => Effect.Effect<void>
    readonly subscribe: Stream.Stream<number>
  }
>() {
  static readonly layerPostgres = Layer.effect(
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

  static readonly layerPubSub = Layer.effect(
    StorePubSub,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<number>()

      return StorePubSub.of({
        publish: (latestSeq) => PubSub.publish(pubsub, latestSeq),
        subscribe: Stream.fromPubSub(pubsub),
      })
    }),
  )
}

/**
 * A service for looking up services for an individual store.
 */
export class StoreLookup extends LayerMap.Service<StoreLookup>()('@livestore/sync-http/server/StoreLookup', {
  lookup: (
    storeId: string,
  ): Layer.Layer<
    SqlClient.SqlClient | StoreTableName | SqliteClient.SqliteClient | StorePubSub | EventsRepo,
    never,
    Path.Path | DatabaseConfig
  > =>
    Effect.gen(function* () {
      const config = yield* DatabaseConfig
      const storeIdHash = yield* sha256Digest(storeId)
      switch (config.kind) {
        case 'sqlite': {
          const path = yield* Path.Path
          const databaseFilePath = path.join(path.resolve(config.directory), `${storeIdHash}.sqlite`)
          return Layer.fresh(EventsRepo.Default).pipe(
            Layer.provideMerge(
              Layer.orDie(
                SqliteClient.layer({
                  filename: databaseFilePath,
                }),
              ),
            ),
            Layer.provideMerge(StoreTableName.fromHash(storeIdHash)),
            Layer.merge(Layer.fresh(StorePubSub.layerPubSub)),
          )
        }
        case 'postgres': {
          // Try to reuse existing Postgres client layers for the same config
          let clientLayer = postgresLayers.get(config)
          if (!clientLayer) {
            clientLayer = Layer.orDie(PgClient.layer(config))
            postgresLayers.set(config, clientLayer)
          }
          return Layer.fresh(EventsRepo.Default).pipe(
            Layer.provideMerge(Layer.fresh(StorePubSub.layerPostgres)),
            Layer.provideMerge(clientLayer),
            Layer.provideMerge(StoreTableName.fromHash(storeIdHash)),
          )
        }
      }
    }).pipe(Layer.unwrapEffect),
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
