import type { SqliteAst } from 'effect-db-schema'
import { SqliteDsl } from 'effect-db-schema'

// A global variable representing component state tables we should create in the database
export const dynamicallyRegisteredTables: Map<string, SqliteAst.Table> = new Map()

export type InputSchema = {
  /** Note when using the object-notation, the object keys are ignored and not used as table names */
  tables: SqliteDsl.DbSchemaInput
  materializedViews?: MaterializedViewDefinitions
  actions: ActionDefinitions<any>
}

export const makeSchema = <TSchema extends InputSchema>(
  schema: TSchema,
): LiveStoreSchema<SqliteDsl.DbSchemaFromInputSchema<TSchema['tables']>> => {
  const inputTables: ReadonlyArray<SqliteDsl.TableDefinition<any, any>> = Array.isArray(schema.tables)
    ? schema.tables
    : Object.values(schema.tables)

  const tables = new Map<string, SqliteAst.Table>()

  for (const table of inputTables) {
    tables.set(table.ast.name, table.ast)
  }

  for (const table of systemTables) {
    tables.set(table.name, table)
  }

  return {
    _DbSchemaType: Symbol('livestore.DbSchemaType') as any,
    tables,
    materializedViews: schema.materializedViews ?? { tableNames: [] },
    actions: schema.actions,
  } satisfies LiveStoreSchema
}

export type SQLWriteStatement = {
  sql: string

  /** Tables written by the statement */
  writeTables: ReadonlyArray<string>
  // TODO refactor this
  argsAlreadyBound?: boolean
}

export type ActionDefinition<TArgs = any> = {
  statement: SQLWriteStatement | ((args: TArgs) => SQLWriteStatement)
  prepareBindValues?: (args: TArgs) => any
}

export type LiveStoreSchema<TDbSchema extends SqliteDsl.DbSchema = SqliteDsl.DbSchema> = {
  /** Only used on type-level */
  readonly _DbSchemaType: TDbSchema

  readonly tables: Map<string, SqliteAst.Table>
  readonly materializedViews: MaterializedViewDefinitions
  readonly actions: ActionDefinitions<any>
}

// TODO
export type MaterializedViewDefinitions = { tableNames: ReadonlyArray<string> }
export type ActionDefinitions<TArgsMap extends Record<string, any>> = {
  [key in keyof TArgsMap]: ActionDefinition<TArgsMap[key]>
}

export const SCHEMA_META_TABLE = '__livestore_schema'

const schemaMetaTable = SqliteDsl.table(SCHEMA_META_TABLE, {
  tableName: SqliteDsl.text({ primaryKey: true }),
  schemaHash: SqliteDsl.integer({ nullable: false }),
  /** ISO date format */
  updatedAt: SqliteDsl.text({ nullable: false }),
})

export type SchemaMetaRow = SqliteDsl.FromTable.RowDecoded<typeof schemaMetaTable>

export const systemTables = [schemaMetaTable.ast]

export const defineMaterializedViews = <M extends MaterializedViewDefinitions>(materializedViews: M) =>
  materializedViews

export const defineActions = <A extends ActionDefinitions<any>>(actions: A) => actions
export const defineAction = <TArgs extends Record<string, any>>(
  action: ActionDefinition<TArgs>,
): ActionDefinition<TArgs> => action

export type GetApplyEventArgs<TActionDefinitionsMap> = RecordValues<{
  [eventType in keyof TActionDefinitionsMap]: {
    eventType: eventType
    args: GetActionArgs<TActionDefinitionsMap[eventType]>
  }
}>

type RecordValues<T> = T extends Record<string, infer V> ? V : never

export type GetActionArgs<A> = A extends ActionDefinition<infer TArgs> ? TArgs : never

// TODO get rid of this
declare global {
  // NOTE Can be extended
  interface LiveStoreActionDefinitionsTypes {
    [key: string]: ActionDefinition
  }
}
