import type { PrettifyFlat } from '@livestore/utils'
import { mapObjectValues } from '@livestore/utils'
import type { Schema } from '@livestore/utils/effect'
import type { SqliteAst } from 'effect-db-schema'
import { SqliteDsl } from 'effect-db-schema'

import { DbSchema } from './index.js'

export type Index = {
  name: string
  columns: string[]
  /** @default false */
  isUnique?: boolean
}

// A global variable representing component state tables we should create in the database
export const componentStateTables: { [key: string]: SqliteAst.Table } = {}

export type InputSchema = {
  tables: {
    [tableName: string]: SqliteDsl.TableDefinition<any, any>
  }
  materializedViews?: MaterializedViewDefinitions
  actions: ActionDefinitions<any>
}

export const makeSchema = <TSchema extends InputSchema>(schema: TSchema): Schema =>
  ({
    tables: { ...mapObjectValues(schema.tables, (_tableName, table) => table.ast), ...systemTables },
    materializedViews: schema.materializedViews ?? {},
    actions: schema.actions,
  }) satisfies Schema

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
  if (Object.keys(componentStateTables).includes(tablePath)) {
    // throw new Error(`Can't register duplicate component: ${name}`)
    console.error(`Can't register duplicate component: ${tablePath}`)
  }

  const schemaWithId = columns as unknown as PrettifyFlat<
    TColumns & {
      id: SqliteDsl.ColumnDefinition<SqliteDsl.FieldType.FieldTypeText<string, string>, false>
    }
  >

  schemaWithId.id = DbSchema.text({ primaryKey: true })

  const tableDef = SqliteDsl.table(tablePath, schemaWithId, [])

  // TODO move into register fn
  componentStateTables[tablePath] = tableDef.ast

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
  tables: TableDefinitions
  materializedViews: MaterializedViewDefinitions
  actions: ActionDefinitions<any>
}

export type TableDefinitions = { [key: string]: SqliteAst.Table }
export type MaterializedViewDefinitions = { [key: string]: {} }
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

export const systemTables = {
  // [EVENTS_TABLE_NAME]: SqliteDsl.table(EVENTS_TABLE_NAME, {
  //   id: SqliteDsl.text({ primaryKey: true }),
  //   type: SqliteDsl.text({ nullable: false }),
  //   args: SqliteDsl.text({ nullable: false }),
  // }).ast,
  [SCHEMA_META_TABLE]: schemaMetaTable.ast,
} satisfies TableDefinitions

export const defineTables = <T extends TableDefinitions>(tables: T) => tables

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
