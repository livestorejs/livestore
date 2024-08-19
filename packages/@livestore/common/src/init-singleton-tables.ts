import type { SynchronousDatabase } from './adapter-types.js'
import type { LiveStoreSchema } from './schema/index.js'
import { getDefaultValuesEncoded } from './schema/schema-helpers.js'
import { prepareBindValues, sql } from './util.js'

export const initializeSingletonTables = (schema: LiveStoreSchema, db: SynchronousDatabase) => {
  for (const [, tableDef] of schema.tables) {
    if (tableDef.options.isSingleton) {
      const defaultValues = getDefaultValuesEncoded(tableDef, undefined)

      const defaultColumnNames = [...Object.keys(defaultValues), 'id']
      const columnValues = defaultColumnNames.map((name) => `$${name}`).join(', ')

      const tableName = tableDef.sqliteDef.name
      const insertQuery = sql`insert into ${tableName} (${defaultColumnNames.join(
        ', ',
      )}) select ${columnValues} where not exists(select 1 from ${tableName} where id = 'singleton')`

      const bindValues = prepareBindValues({ ...defaultValues, id: 'singleton' }, insertQuery)

      db.execute(insertQuery, bindValues)
    }
  }
}
