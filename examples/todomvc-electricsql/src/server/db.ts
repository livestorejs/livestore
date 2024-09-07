import type { MutationLogMetaRow } from '@livestore/common'
import postgres from 'postgres'

export const makeDb = () => {
  const sql = postgres({
    database: 'electric',
    user: 'postgres',
    password: 'password',
    host: 'localhost',
  })

  const migrate = () =>
    sql`
    CREATE TABLE IF NOT EXISTS events (
			id TEXT PRIMARY KEY,
			mutation TEXT NOT NULL,
			args_json TEXT NOT NULL,
			schema_hash INTEGER NOT NULL,
			created_at TEXT NOT NULL
    );
	`

  const createEvents = async (events: ReadonlyArray<MutationLogMetaRow>) => {
    const mappedEvents = events.map((event) => ({
      id: event.id,
      mutation: event.mutation,
      args_json: event.argsJson,
      schema_hash: event.schemaHash,
      created_at: event.createdAt,
    }))

    await sql`INSERT INTO events ${sql(mappedEvents)}`
  }

  return {
    migrate,
    createEvents,
    disconnect: () => sql.end(),
  }
}
