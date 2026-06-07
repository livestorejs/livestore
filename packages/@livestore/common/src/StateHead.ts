import { Context, Effect, Layer, Option } from '@livestore/utils/effect'

import type { SqliteDb } from './adapter-types.ts'
import * as EventSequenceNumber from './schema/EventSequenceNumber/mod.ts'
import { SystemTables } from './schema/mod.ts'
import { makeColumnSpec } from './schema/state/sqlite/column-spec.ts'
import { hasTable } from './sqlite-db-helper.ts'
import { findManyRows, insertRow } from './sql-queries/index.ts'
import { prepareBindValues, sql } from './util.ts'

export const TypeId = '~@livestore/common/StateHead' as const
export type TypeId = typeof TypeId

const STATE_HEAD_ROW_ID = 1
const LEGACY_SESSION_CHANGESET_TABLE = SystemTables.MATERIALIZATION_JOURNAL_META_TABLE

/**
 * Persists and reads the latest event sequence number reflected by the state database.
 *
 * @remarks
 *
 * StateHead exists so LiveStore can associate a state database snapshot with
 * the event sequence number it reflects. Persisted web sessions can initialize
 * from an imported state snapshot without importing the eventlog database, but
 * they still need an initial leader head that matches the snapshot contents.
 * Materialization journal rows are rollback records and may be pruned, so they
 * are not a reliable source for this snapshot head.
 *
 * @privateRemarks
 *
 * Stores created before `__livestore_state_head` existed used
 * `__livestore_session_changeset` as an implicit state-head marker. We Keep that
 * fallback inside this service so new call sites do not depend on the legacy table.
 */
export interface StateHeadService {
  readonly [TypeId]: TypeId
  /** Persists the latest event sequence number reflected by the state database. */
  set: (head: EventSequenceNumber.Client.Composite) => Effect.Effect<void>
  /** Returns the current state database head, defaulting to {@link EventSequenceNumber.Client.ROOT} for an empty state database. */
  get: () => Effect.Effect<EventSequenceNumber.Client.Composite>
}

export class StateHead extends Context.Tag('@livestore/common/StateHead')<StateHead, StateHeadService>() {}

export const make = ({ dbState }: { dbState: SqliteDb }) => {
  const getStateHeadOption = Effect.sync(() => {
    if (hasStateHeadTable(dbState) === false) {
      return Option.none()
    }

    const [statement, bindValues] = findManyRows({
      tableName: SystemTables.STATE_HEAD_META_TABLE,
      columns: SystemTables.stateHeadMetaTable.sqliteDef.columns,
      where: { id: STATE_HEAD_ROW_ID },
      limit: 1,
    })

    const row = dbState.select<SystemTables.StateHeadMetaRow>(
      statement,
      prepareBindValues(bindValues, statement),
    )[0]

    return Option.fromNullable(row).pipe(Option.map(rowToStateHead))
  })

  const getLegacySessionChangesetHeadOption = Effect.sync(() => {
    if (hasSessionChangesetTable(dbState) === false) {
      return Option.none()
    }

    const row = dbState.select<{
      seqNumGlobal: EventSequenceNumber.Global.Type
      seqNumClient: EventSequenceNumber.Client.Type
      seqNumRebaseGeneration: number
    }>(
      sql`SELECT seqNumGlobal, seqNumClient, seqNumRebaseGeneration
        FROM ${LEGACY_SESSION_CHANGESET_TABLE}
        ORDER BY seqNumGlobal DESC, seqNumClient DESC, seqNumRebaseGeneration DESC
        LIMIT 1`,
    )[0]

    return Option.fromNullable(row).pipe(Option.map(rowToStateHead))
  })

  // Older stores used the session changeset table as an implicit state-head marker. We fall back to it.
  const getOption = getStateHeadOption.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => getLegacySessionChangesetHeadOption,
        onSome: (_) => Effect.succeed(Option.some(_)),
      }),
    ),
  )

  return StateHead.of({
    [TypeId]: TypeId,
    set: (head) =>
      Effect.sync(() => {
        ensureStateHeadTable(dbState)
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

        dbState.execute(statement, prepareBindValues(bindValues, statement))
      }),
    get: () => getOption.pipe(Effect.map(Option.getOrElse(() => EventSequenceNumber.Client.ROOT))),
  })
}

export const layer = (options: { dbState: SqliteDb }) => Layer.succeed(StateHead, make(options))

const hasStateHeadTable = (dbState: SqliteDb) => hasTable(dbState, SystemTables.STATE_HEAD_META_TABLE)

const hasSessionChangesetTable = (dbState: SqliteDb) => hasTable(dbState, LEGACY_SESSION_CHANGESET_TABLE)

const ensureStateHeadTable = (dbState: SqliteDb) => {
  if (hasStateHeadTable(dbState) === true) return

  // Temporary compatibility bridge for legacy persisted web fast-path snapshots
  // created before `__livestore_state_head` existed. Remove this once those
  // snapshots no longer need to be writable without a full migration first.
  dbState.execute(
    sql`CREATE TABLE IF NOT EXISTS "${SystemTables.STATE_HEAD_META_TABLE}" (${makeColumnSpec(SystemTables.stateHeadMetaTable.sqliteDef.ast)}) STRICT`,
  )
}

const rowToStateHead = (row: {
  seqNumGlobal: EventSequenceNumber.Global.Type
  seqNumClient: EventSequenceNumber.Client.Type
  seqNumRebaseGeneration: number
}) =>
  EventSequenceNumber.Client.Composite.make({
    global: row.seqNumGlobal,
    client: row.seqNumClient,
    rebaseGeneration: row.seqNumRebaseGeneration,
  })
