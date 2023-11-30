import type { SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { ActionDefinitions } from './action.js'
import { systemTables } from './system-tables.js'

export * from './action.js'
export * from './system-tables.js'

export type LiveStoreSchema<TDbSchema extends SqliteDsl.DbSchema = SqliteDsl.DbSchema> = {
  /** Only used on type-level */
  readonly _DbSchemaType: TDbSchema

  readonly tables: Map<string, SqliteAst.Table>
  readonly actions: ActionDefinitions<any>
}

export const dynamicallyRegisteredTables: Map<string, SqliteAst.Table> = new Map()

export type InputSchema = {
  tables: SqliteDsl.DbSchemaInput
  actions: ActionDefinitions<any>
}

export const makeSchema = <TInputSchema extends InputSchema>(
  /** Note when using the object-notation for tables, the object keys are ignored and not used as table names */
  schema: TInputSchema,
): LiveStoreSchema<SqliteDsl.DbSchemaFromInputSchema<TInputSchema['tables']>> => {
  const inputTables: ReadonlyArray<SqliteDsl.TableDefinition<any, any>> = Array.isArray(schema.tables)
    ? schema.tables
    : // TODO validate that table names are unique in this case
      Object.values(schema.tables)

  const tables = new Map<string, SqliteAst.Table>()

  for (const table of inputTables) {
    // TODO validate tables (e.g. index names are unique)
    tables.set(table.ast.name, table.ast)
  }

  for (const table of systemTables) {
    tables.set(table.name, table)
  }

  return {
    _DbSchemaType: Symbol('livestore.DbSchemaType') as any,
    tables,
    actions: schema.actions,
  } satisfies LiveStoreSchema
}
