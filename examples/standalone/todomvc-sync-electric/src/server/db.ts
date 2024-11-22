import type { MutationEvent } from '@livestore/livestore'
import postgres from 'postgres'

export const makeDb = (roomId: string) => {
  const tableName = `events_${roomId}`

  const sql = postgres({
    database: 'electric',
    user: 'postgres',
    password: 'password',
    host: 'localhost',
  })

  const migrate = () =>
    sql`
    CREATE TABLE IF NOT EXISTS ${sql(tableName)} (
			id TEXT PRIMARY KEY,
			mutation TEXT NOT NULL,
			args JSONB NOT NULL
    );
	`
  // -- schema_hash INTEGER NOT NULL,
  // -- created_at TEXT NOT NULL

  const createEvents = async (events: ReadonlyArray<MutationEvent.AnyEncoded>) => {
    await sql`INSERT INTO ${sql(tableName)} ${sql(events)}`
  }

  return {
    migrate,
    createEvents,
    disconnect: () => sql.end(),
  }
}
