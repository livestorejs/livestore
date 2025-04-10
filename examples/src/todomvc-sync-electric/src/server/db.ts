import type { LiveStoreEvent } from '@livestore/livestore'
import { toTableName } from '@livestore/sync-electric'
import postgres from 'postgres'

export const makeDb = (storeId: string) => {
  const tableName = toTableName(storeId)

  const sql = postgres({
    database: 'electric',
    user: 'postgres',
    password: 'password',
    host: 'localhost',
  })

  const migrate = () =>
    sql`
    CREATE TABLE IF NOT EXISTS ${sql(tableName)} (
			"id" INTEGER PRIMARY KEY,
      "parentId" INTEGER,
			"mutation" TEXT NOT NULL,
			"args" JSONB NOT NULL,
      "clientId" TEXT NOT NULL,
      "sessionId" TEXT NOT NULL
    );
	`
  // -- schema_hash INTEGER NOT NULL,
  // -- created_at TEXT NOT NULL

  const createEvents = async (events: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) => {
    await sql`INSERT INTO ${sql(tableName)} ${sql(events)}`
  }

  return {
    migrate,
    createEvents,
    disconnect: () => sql.end(),
  }
}
