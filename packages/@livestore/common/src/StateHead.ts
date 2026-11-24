import { Context, Effect, Layer } from '@livestore/utils/effect'

import type { SqliteError } from './adapter-types.ts'
import { execSql, selectSql } from './leader-thread/connection.ts'
import * as EventSequenceNumber from './schema/EventSequenceNumber/mod.ts'
import { SystemTables } from './schema/mod.ts'
import { findManyRows, insertRow } from './sql-queries/index.ts'
import * as StateSqliteDb from './StateSqliteDb.ts'

export const TypeId = '~@livestore/common/StateHead' as const
export type TypeId = typeof TypeId

const STATE_HEAD_ROW_ID = 1

/**
 * Persists and reads the latest event sequence number reflected by the state database.
 */
export interface Service {
  readonly [TypeId]: TypeId
  /** Persists the latest event sequence number reflected by the state database. */
  set: (head: EventSequenceNumber.Client.Composite) => Effect.Effect<void, SqliteError>
  /** Returns the persisted head, or the root when the current-schema table has no row. */
  get: Effect.Effect<EventSequenceNumber.Client.Composite, SqliteError>
}

export class StateHead extends Context.Service<StateHead, Service>()('@livestore/common/StateHead') {}

export const make = Effect.gen(function* () {
  const dbState = yield* StateSqliteDb.StateSqliteDb

  return StateHead.of({
    [TypeId]: TypeId,
    set: (head) => {
      const [statement, bindValues] = insertRow({
        tableName: SystemTables.STATE_HEAD_META_TABLE,
        columns: SystemTables.stateHeadMetaTable.sqliteDef.columns,
        values: {
          id: STATE_HEAD_ROW_ID,
          seqNumGlobal: head.global,
          seqNumClient: head.client,
          seqNumRebaseGeneration: head.rebaseGeneration,
        },
        options: { orReplace: true },
      })

      return execSql(dbState, statement, bindValues)
    },
    get: Effect.suspend(() => {
      const [statement, bindValues] = findManyRows({
        tableName: SystemTables.STATE_HEAD_META_TABLE,
        columns: SystemTables.stateHeadMetaTable.sqliteDef.columns,
        where: { id: STATE_HEAD_ROW_ID },
        limit: 1,
      })
      return selectSql<SystemTables.StateHeadMetaRow>(dbState, statement, bindValues).pipe(
        Effect.map(([row]) =>
          row === undefined
            ? EventSequenceNumber.Client.ROOT
            : EventSequenceNumber.Client.Composite.make({
                global: row.seqNumGlobal,
                client: row.seqNumClient,
                rebaseGeneration: row.seqNumRebaseGeneration,
              }),
        ),
      )
    }),
  })
})

export const layer = Layer.effect(StateHead, make)

export const layerTest = Layer.succeed(
  StateHead,
  StateHead.of({
    [TypeId]: TypeId,
    set: () => Effect.void,
    get: Effect.succeed(EventSequenceNumber.Client.ROOT),
  }),
)
