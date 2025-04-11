import type { SqliteDb } from '../adapter-types.js'
import type { ParamsObject } from '../util.js'
import { prepareBindValues } from '../util.js'

// TODO bring back statement caching
// will require proper scope-aware cleanup etc (for testing and apps with multiple LiveStore instances)
// const cachedStmts = new Map<string, PreparedStatement>()

export const dbExecute = (db: SqliteDb, queryStr: string, bindValues?: ParamsObject) => {
  // let stmt = cachedStmts.get(queryStr)
  // if (!stmt) {
  const stmt = db.prepare(queryStr)
  // cachedStmts.set(queryStr, stmt)
  // }

  const preparedBindValues = bindValues ? prepareBindValues(bindValues, queryStr) : undefined

  stmt.execute(preparedBindValues)

  stmt.finalize()
}

export const dbSelect = <T>(db: SqliteDb, queryStr: string, bindValues?: ParamsObject) => {
  // let stmt = cachedStmts.get(queryStr)
  // if (!stmt) {
  const stmt = db.prepare(queryStr)
  // cachedStmts.set(queryStr, stmt)
  // }

  const res = stmt.select<T>(bindValues ? prepareBindValues(bindValues, queryStr) : undefined)
  stmt.finalize()
  return res
}

export interface SchemaManager {
  getEventDefInfos: () => ReadonlyArray<EventDefInfo>

  setEventDefInfo: (mutationDefInfo: EventDefInfo) => void
}

export type EventDefInfo = {
  mutationName: string
  schemaHash: number
}
