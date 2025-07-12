import { Effect } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.js'
import { MATERIALIZATION_STATUS_TABLE } from '../schema/state/sqlite/system-tables.js'
import { sql } from '../util.js'
import { execSql } from './connection.js'

export const initMaterializationStatus = (dbState: SqliteDb) =>
  Effect.gen(function* () {
    // Create materialization status row if it doesn't exist
    yield* execSql(
      dbState,
      sql`INSERT INTO ${MATERIALIZATION_STATUS_TABLE} (head)
          SELECT ${EventSequenceNumber.ROOT.global}
          WHERE NOT EXISTS (SELECT 1 FROM ${MATERIALIZATION_STATUS_TABLE})`,
      {},
    )
  })

export const getMaterializationHeadFromDb = (dbState: SqliteDb): EventSequenceNumber.GlobalEventSequenceNumber =>
  dbState.select<{ head: EventSequenceNumber.GlobalEventSequenceNumber }>(
    sql`select head from ${MATERIALIZATION_STATUS_TABLE}`,
  )[0]?.head ?? EventSequenceNumber.ROOT.global

export const updateMaterializationHead = (dbState: SqliteDb, head: EventSequenceNumber.EventSequenceNumber) =>
  dbState.execute(sql`UPDATE ${MATERIALIZATION_STATUS_TABLE} SET head = ${head.global}`)