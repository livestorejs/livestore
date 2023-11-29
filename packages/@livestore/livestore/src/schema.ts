import { type PrettifyFlat, shouldNeverHappen } from '@livestore/utils'
import type { Schema } from '@livestore/utils/effect'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

import { DbSchema } from './index.js'

export type Index = {
  name: string
  columns: string[]
  /** @default false */
  isUnique?: boolean
}

// A global variable representing component state tables we should create in the database
export const dynamicallyRegisteredTables: Map<string, SqliteAst.Table> = new Map()

/** Note when using the object-notation, the object keys are ignored and not used as table names */
export type InputSchema = {
  tables:
    | {
        [tableName: string]: SqliteDsl.TableDefinition<any, any>
      }
    | ReadonlyArray<SqliteDsl.TableDefinition<any, any>>
  materializedViews?: MaterializedViewDefinitions
  actions: ActionDefinitions<any>
}

export const makeSchema = <TSchema extends InputSchema>(schema: TSchema): Schema => {
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
    _: Symbol('livestore.Schema') as any,
    tables,
    materializedViews: schema.materializedViews ?? { tableNames: [] },
    actions: schema.actions,
  } satisfies Schema
}

export type ComponentStateSchema = SqliteDsl.TableDefinition<any, any> & {
  // TODO
  register: () => void
}

// TODO get rid of "side effect" in this function (via explicit register fn)
export const defineComponentStateSchema = <TName extends string, TColumns extends SqliteDsl.Columns>(
  // TODO get rid of the `name` param here and use the `componentKey` name instead
  name: TName,
  columns: TColumns,
): SqliteDsl.TableDefinition<
  `components__${TName}`,
  PrettifyFlat<TColumns & { id: SqliteDsl.ColumnDefinition<SqliteDsl.FieldType.FieldTypeText<string, string>, false> }>
> => {
  const tablePath = `components__${name}` as const

  const schemaWithId = columns as unknown as PrettifyFlat<
    TColumns & {
      id: SqliteDsl.ColumnDefinition<SqliteDsl.FieldType.FieldTypeText<string, string>, false>
    }
  >

  schemaWithId.id = DbSchema.text({ primaryKey: true })

  const tableDef = SqliteDsl.table(tablePath, schemaWithId, [])

  if (
    dynamicallyRegisteredTables.has(tablePath) &&
    SqliteAst.hash(dynamicallyRegisteredTables.get(tablePath)!) !== SqliteAst.hash(tableDef.ast)
  ) {
    console.error('previous tableDef', dynamicallyRegisteredTables.get(tablePath), 'new tableDef', tableDef.ast)
    return shouldNeverHappen(`Table with name "${name}" was already previously defined with a different definition`)
  }

  // TODO move into register fn
  dynamicallyRegisteredTables.set(tablePath, tableDef.ast)

  return tableDef
}

export type SQLWriteStatement = {
  sql: string

  /** Tables written by the statement */
  writeTables: string[]
  // TODO refactor this
  argsAlreadyBound?: boolean
}

export type ActionDefinition<TArgs = any> = {
  statement: SQLWriteStatement | ((args: TArgs) => SQLWriteStatement)
  prepareBindValues?: (args: TArgs) => any
}

export type Schema = {
  readonly _: unique symbol
  readonly tables: Map<string, SqliteAst.Table>
  readonly materializedViews: MaterializedViewDefinitions
  readonly actions: ActionDefinitions<any>
}

// TODO
export type MaterializedViewDefinitions = { tableNames: string[] }
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

export const systemTables = [
  // SqliteDsl.table(EVENTS_TABLE_NAME, {
  //   id: SqliteDsl.text({ primaryKey: true }),
  //   type: SqliteDsl.text({ nullable: false }),
  //   args: SqliteDsl.text({ nullable: false }),
  // }).ast,
  schemaMetaTable.ast,
]

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
