import { Context, Layer } from '@livestore/utils/effect'

import type { SqliteDb } from './sqlite-types.ts'

/** The SQLite database containing LiveStore's event log. */
export class EventlogSqliteDb extends Context.Service<EventlogSqliteDb, SqliteDb>()(
  '@livestore/common/EventlogSqliteDb',
) {}

/** Provides an event-log database under its role-specific service identity. */
export const layer = (db: SqliteDb) => Layer.succeed(EventlogSqliteDb, db)
