import type { SqliteDsl } from 'effect-db-schema'

import type { ActionDefinitions } from './action.js'
import { systemTables } from './system-tables.js'
import type { TableDef } from './table-def.js'

export * from './action.js'
export * from './system-tables.js'
export * as DbSchema from './table-def.js'
export * as ParseUtils from './parse-utils.js'

// export { SqliteDsl as DbSchema } from 'effect-db-schema'

export type LiveStoreSchema<TDbSchema extends SqliteDsl.DbSchema = SqliteDsl.DbSchema> = {
  /** Only used on type-level */
  readonly _DbSchemaType: TDbSchema

  readonly tables: Map<string, TableDef>
  readonly actions: ActionDefinitions<any>
}

export type InputSchema = {
  tables: Record<string, TableDef> | ReadonlyArray<TableDef>
  actions: ActionDefinitions<any>
}

export const makeSchema = <TInputSchema extends InputSchema>(
  /** Note when using the object-notation for tables, the object keys are ignored and not used as table names */
  schema: TInputSchema,
): LiveStoreSchema<DbSchemaFromInputSchemaTables<TInputSchema['tables']>> => {
  const inputTables: ReadonlyArray<TableDef> = Array.isArray(schema.tables)
    ? schema.tables
    : // TODO validate that table names are unique in this case
      Object.values(schema.tables)

  const tables = new Map<string, TableDef>()

  for (const tableDef of inputTables) {
    // TODO validate tables (e.g. index names are unique)
    tables.set(tableDef.sqliteDef.ast.name, tableDef)
  }

  for (const tableDef of systemTables) {
    tables.set(tableDef.sqliteDef.name, tableDef)
  }

  return {
    _DbSchemaType: Symbol('livestore.DbSchemaType') as any,
    tables,
    actions: schema.actions,
  } satisfies LiveStoreSchema
}

/**
 * In case of ...
 * - array: we use the table name of each array item (= table definition) as the object key
 * - object: we discard the keys of the input object and use the table name of each object value (= table definition) as the new object key
 */
export type DbSchemaFromInputSchemaTables<TTables extends InputSchema['tables']> =
  TTables extends ReadonlyArray<TableDef>
    ? { [K in TTables[number] as K['sqliteDef']['name']]: K['sqliteDef'] }
    : TTables extends Record<string, TableDef>
      ? { [K in keyof TTables as TTables[K]['sqliteDef']['name']]: TTables[K]['sqliteDef'] }
      : never
