import {
  type Adapter,
  type Coordinator,
  getExecArgsFromMutation,
  type LockStatus,
  makeNextMutationEventIdPair,
  migrateDb,
  type NetworkStatus,
  ROOT_ID,
  type SynchronousDatabase,
} from '@livestore/common'
import { makeMutationEventSchema } from '@livestore/common/schema'
import { Effect, FileSystem, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import type { DatabaseInterface } from './sqlite.js'
import { makeSyncDb } from './sqlite.js'
import { makeSynchronousDatabase } from './sqlite/make-sync-db.js'
import { importBytesToDb, loadSqlite3Wasm, makeInMemoryDb, makeNodeFsDb } from './sqlite/sqlite-utils.js'

export type { DatabaseInterface } from './sqlite.js'

export const makeNodeAdapter = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  return (makeDb: DatabaseInterface.Constructor, dbFilePath: string): Adapter => {
    return (({ schema }) =>
      Effect.gen(function* () {
        const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({
          isConnected: true,
          timestampMs: Date.now(),
        })

        const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

        const sessionId = 'todo'

        // const syncDb = makeSyncDb({ _tag: 'in-memory' }, makeDb)
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
        const nodeFsDb = makeNodeFsDb(sqlite3, dbFilePath)
        const syncNodeFsDb = makeSynchronousDatabase(sqlite3, nodeFsDb)
        const mutationEventSchema = makeMutationEventSchema(schema)

        yield* migrateDb({ db: syncNodeFsDb, schema })

        const inMemoryDb = makeInMemoryDb(sqlite3)
        const syncInMemoryDb = makeSynchronousDatabase(sqlite3, inMemoryDb)

        const fileData = yield* fs.readFile(dbFilePath).pipe(Effect.either)
        if (fileData._tag === 'Right') {
          importBytesToDb(sqlite3, inMemoryDb, fileData.right, false)
        } else {
          yield* Effect.logWarning('Failed to load database file', fileData.left)
        }

        const currentMutationEventIdRef = { current: ROOT_ID }
        const nextMutationEventIdPair = makeNextMutationEventIdPair(currentMutationEventIdRef)

        const coordinator = {
          networkStatus,
          execute: (sql, params) =>
            Effect.sync(() => {
              console.log('execute', sql, params)
              return syncNodeFsDb.execute(sql, params)
            }),
          mutate: (mutationEventEncoded) =>
            Effect.gen(function* () {
              const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)
              const mutationDef = schema.mutations.get(mutationEventDecoded.mutation)!
              const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })
              for (const { statementSql, bindValues } of execArgsArr) {
                console.log('mutate', statementSql, bindValues)
                // console.debug(mutationName, statementSql, bindValues)
                // TODO use cached prepared statements instead of exec
                syncNodeFsDb.execute(statementSql, bindValues)
              }
            }).pipe(Effect.orDie),
          export: Effect.dieMessage('Not implemented'),
          devtools: { appHostId: ' ', enabled: false },
          lockStatus,
          sessionId,
          getMutationLogData: Effect.dieMessage('Not implemented'),
          syncMutations: Stream.never,
          nextMutationEventIdPair,
          getCurrentMutationEventId: Effect.gen(function* () {
            // const global = (yield* seqState.get).pipe(Option.getOrElse(() => 0))
            // const local = (yield* seqLocalOnlyState.get).pipe(Option.getOrElse(() => 0))
            // return { global, local }
            return currentMutationEventIdRef.current
          }),
        } satisfies Coordinator

        return { coordinator, syncDb: syncInMemoryDb }
      })) satisfies Adapter
  }
})
