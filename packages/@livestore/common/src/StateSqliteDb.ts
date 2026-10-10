import { Context, Layer } from '@livestore/utils/effect'

import type { SqliteDb } from './sqlite-types.ts'

/** The SQLite database containing LiveStore's materialized state. */
export class StateSqliteDb extends Context.Service<StateSqliteDb, SqliteDb>()('@livestore/common/StateSqliteDb') {}

/** Provides a materialized-state database under its role-specific service identity. */
export const layer = (db: SqliteDb) => Layer.succeed(StateSqliteDb, db)
