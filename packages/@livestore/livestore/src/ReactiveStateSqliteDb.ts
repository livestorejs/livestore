import { Context, Layer } from '@livestore/utils/effect'

import type { SqliteDbWrapper } from './SqliteDbWrapper.ts'

/** State database enhanced with LiveStore's query cache and reactivity bookkeeping. */
export class ReactiveStateSqliteDb extends Context.Service<ReactiveStateSqliteDb, SqliteDbWrapper>()(
  '@livestore/livestore/ReactiveStateSqliteDb',
) {}

export const layer = (db: SqliteDbWrapper) => Layer.succeed(ReactiveStateSqliteDb, db)
