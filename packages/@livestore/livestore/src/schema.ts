import type { Backend } from './backends/index.js'
import { EVENTS_TABLE_NAME } from './events.js'
import type { InMemoryDatabase } from './inMemoryDatabase.js'
import { sql } from './util.js'

export type ColumnDefinition = {
  nullable?: boolean
  primaryKey?: boolean
} & (
  | { type: 'text'; default?: string }
  | { type: 'json'; default?: string }
  | { type: 'integer'; default?: number }
  | { type: 'boolean'; default?: boolean }
  | { type: 'real'; default?: number }
  | { type: 'blob'; default?: any }
) // sqlite uses numbers for booleans but we fake it

// TODO: defaults should be nullable for nullable columns
type ColumnDefinitionWithDefault = {
  primaryKey?: boolean
} & (
  | { type: 'text'; nullable?: true; default: string }
  | { type: 'json'; nullable?: true; default: string }
  | { type: 'integer'; nullable?: true; default: number }
  | { type: 'boolean'; nullable?: true; default: boolean }
  | { type: 'real'; nullable: true; default: number | null }
  | { type: 'blob'; nullable: true; default: any | null }
)

export type TableDefinition = {
  columns: {
    [key: string]: ColumnDefinition
  }
  /**
   * Can be used for various purposes e.g. to provide a foreign key constraint like below:
   * ```ts
   * columnsRaw: (columnsStr) => `${columnsStr}, foreign key (userId) references users(id)`
   * ```
   */
  columnsRaw?: (columnsStr: string) => string
  indexes?: Index[]
}

export type Index = {
  name: string
  columns: string[]
  /** @default false */
  isUnique?: boolean
}

export type ComponentStateSchema<T> = {
  componentType: string
  columns: {
    [k in keyof T]: ColumnDefinitionWithDefault
  }
}

// A global variable representing component state tables we should create in the database
export const componentStateTables: { [key: string]: TableDefinition } = {}

export const defineComponentStateSchema = <T>(
  schema: ComponentStateSchema<T>,
): ComponentStateSchema<T & { id: string }> => {
  const tablePath = `components__${schema.componentType}`
  if (Object.keys(componentStateTables).includes(tablePath)) {
    // throw new Error(`Can't register duplicate component: ${name}`)
    console.error(`Can't register duplicate component: ${tablePath}`)
  }

  const schemaWithId = schema as ComponentStateSchema<T & { id: string }>

  schemaWithId.columns.id = { type: 'text', primaryKey: true } as any

  componentStateTables[tablePath] = schemaWithId as any

  return schemaWithId
}

type SQLWriteStatement = {
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

export type TableDefinitions = { [key: string]: TableDefinition }
export type MaterializedViewDefinitions = { [key: string]: {} }
export type ActionDefinitions<TArgsMap extends Record<string, any>> = {
  [key in keyof TArgsMap]: ActionDefinition<TArgsMap[key]>
}

export const EVENT_CURSOR_TABLE = 'livestore__event_cursor'

const systemTables = {
  [EVENTS_TABLE_NAME]: {
    columns: {
      id: { type: 'text', primaryKey: true },
      type: { type: 'text', nullable: false },
      args: { type: 'text', nullable: false },
    },
  },
  [EVENT_CURSOR_TABLE]: {
    columns: {
      id: { type: 'text', primaryKey: true },
      cursor: { type: 'text', nullable: false },
    },
  },
} as const

export const defineSchema = <S extends Schema>(schema: S) => mergeSystemSchema(schema)

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

declare global {
  // NOTE Can be extended
  interface LiveStoreActionDefinitionsTypes {
    [key: string]: ActionDefinition
  }
}

const mergeSystemSchema = <S extends Schema>(schema: S) => {
  return {
    ...schema,
    tables: {
      ...schema.tables,
      ...systemTables,
    },
  }
}

/**
 * Destructively load a schema into a database,
 * dropping any existing tables and creating new ones.
 */
export const loadSchema = async (backend: InMemoryDatabase | Backend, schema: Schema) => {
  const fullSchemaWithComponents = { ...schema, tables: { ...schema.tables, ...componentStateTables } }

  // Loop through all the tables and create them in the SQLite database
  for (const [tableName, tableDefinition] of Object.entries(fullSchemaWithComponents.tables)) {
    const primaryKeys = Object.entries(tableDefinition.columns)
      .filter(([_, columnDef]) => columnDef.primaryKey)
      .map(([columnName, _]) => columnName)
    const columnDefStrs = Object.entries(tableDefinition.columns).map(([columnName, column]) =>
      toSqliteColumnSpec(columnName, column),
    )
    if (primaryKeys.length > 0) {
      columnDefStrs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
    }
    const mapColumns = tableDefinition.columnsRaw ?? ((_) => _)
    const columnSpec = mapColumns(columnDefStrs.join(', '))

    backend.execute(sql`drop table if exists ${tableName}`)

    backend.execute(sql`create table if not exists ${tableName} (${columnSpec});`)
  }

  await createIndexes(backend, schema)
}

const toSqliteColumnSpec = (columnName: string, column: ColumnDefinition) => {
  const columnType = column.type === 'boolean' ? 'integer' : column.type
  // const primaryKey = column.primaryKey ? 'primary key' : ''
  const nullable = column.nullable === false ? 'not null' : ''
  const defaultValue =
    column.default === undefined
      ? ''
      : column.type === 'text'
      ? `default '${column.default}'`
      : `default ${column.default}`

  return `${columnName} ${columnType} ${nullable} ${defaultValue}`
}

const createIndexFromDefinition = (tableName: string, index: Index) => {
  const uniqueStr = index.isUnique ? 'UNIQUE' : ''
  return sql`create ${uniqueStr} index ${index.name} on ${tableName} (${index.columns.join(', ')})`
}

const createIndexes = async (db: Backend | InMemoryDatabase, schema: Schema) => {
  for (const [tableName, tableDefinition] of Object.entries(schema.tables)) {
    if (tableDefinition.indexes !== undefined) {
      for (const index of tableDefinition.indexes) {
        db.execute(createIndexFromDefinition(tableName, index))
      }
    }
  }
}
