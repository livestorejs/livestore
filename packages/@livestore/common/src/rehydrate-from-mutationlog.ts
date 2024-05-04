import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { MainDatabase } from './database.js'
import { getExecArgsFromMutation } from './mutation.js'
import type { LiveStoreSchema } from './schema/index.js'

type MutationLogRow = {
  id: string
  mutation: string
  args_json: string
  schema_hash: number
  created_at: string
}

export const rehydrateFromMutationLog = ({
  logDb,
  db,
  schema,
}: {
  logDb: MainDatabase
  db: MainDatabase
  schema: LiveStoreSchema
}) => {
  try {
    const stmt = logDb.prepare('SELECT * FROM mutation_log ORDER BY id ASC')
    const results = stmt.select<MutationLogRow>(undefined)

    performance.mark('livestore:hydrate-from-mutationlog:start')

    for (const row of results) {
      const mutationDef = schema.mutations.get(row.mutation) ?? shouldNeverHappen(`Unknown mutation ${row.mutation}`)

      if (Schema.hash(mutationDef.schema) !== row.schema_hash) {
        throw new Error(`Schema hash mismatch for mutation ${row.mutation}`)
      }

      const argsDecodedEither = Schema.decodeUnknownEither(Schema.parseJson(mutationDef.schema))(row.args_json)
      if (argsDecodedEither._tag === 'Left') {
        return shouldNeverHappen(`\
There was an error decoding the persisted mutation event args for mutation "${row.mutation}".
This likely means the schema has changed in an incompatible way.

Error: ${argsDecodedEither.left}
        `)
      }

      const mutationEventDecoded = {
        id: row.id,
        mutation: row.mutation,
        args: argsDecodedEither.right,
      }
      // const argsEncoded = JSON.parse(row.args_json)
      // const mutationSqlRes =
      //   typeof mutation.sql === 'string'
      //     ? mutation.sql
      //     : mutation.sql(Schema.decodeUnknownSync(mutation.schema)(argsEncoded))
      // const mutationSql = typeof mutationSqlRes === 'string' ? mutationSqlRes : mutationSqlRes.sql
      // const bindValues = typeof mutationSqlRes === 'string' ? argsEncoded : mutationSqlRes.bindValues

      const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

      for (const { statementSql, bindValues } of execArgsArr) {
        try {
          db.execute(statementSql, bindValues)
          // console.log(`Re-executed mutation ${mutationSql}`, bindValues)
        } catch (e) {
          console.error(`Error executing migration for mutation ${statementSql}`, bindValues, e)
          debugger
          throw e
        }
      }
    }
  } catch (e) {
    console.error('Error while rehydrating database from mutation log', e)
    debugger
    throw e
  } finally {
    performance.mark('livestore:hydrate-from-mutationlog:end')
    performance.measure(
      'livestore:hydrate-from-mutationlog',
      'livestore:hydrate-from-mutationlog:start',
      'livestore:hydrate-from-mutationlog:end',
    )
  }
}
