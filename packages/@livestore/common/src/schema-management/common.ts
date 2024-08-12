import type { SynchronousDatabase } from '../adapter-types.js'
import type { ParamsObject } from '../util.js'
import { prepareBindValues } from '../util.js'

// TODO bring back statement caching
// will require proper scope-aware cleanup etc (for testing and apps with multiple LiveStore instances)
// const cachedStmts = new Map<string, PreparedStatement>()

export const dbExecute = (db: SynchronousDatabase, queryStr: string, bindValues?: ParamsObject) => {
  // let stmt = cachedStmts.get(queryStr)
  // if (!stmt) {
  const stmt = db.prepare(queryStr)
  // cachedStmts.set(queryStr, stmt)
  // }

  const preparedBindValues = bindValues ? prepareBindValues(bindValues, queryStr) : undefined

  stmt.execute(preparedBindValues)
}

export const dbSelect = <T>(db: SynchronousDatabase, queryStr: string, bindValues?: ParamsObject) => {
  // let stmt = cachedStmts.get(queryStr)
  // if (!stmt) {
  const stmt = db.prepare(queryStr)
  // cachedStmts.set(queryStr, stmt)
  // }

  return stmt.select<T>(bindValues ? prepareBindValues(bindValues, queryStr) : undefined)
}

export interface SchemaManager {
  getMutationDefInfos: () => ReadonlyArray<MutationDefInfo>

  setMutationDefInfo: (mutationDefInfo: MutationDefInfo) => void
}

export type MutationDefInfo = {
  mutationName: string
  schemaHash: number
}
