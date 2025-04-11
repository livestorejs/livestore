import { shouldNeverHappen } from '@livestore/utils'

import type { QueryBuilder } from '../query-builder/api.js'
import { ClientDocumentTableDefSymbol, tableIsClientDocumentTable } from './client-document-def.js'
import { type Materializer, rawSqlEvent, rawSqlMaterializer } from './EventDef.js'
import type { State } from './schema.js'
import { systemTables } from './system-tables.js'
import { type TableDef, type TableDefBase } from './table-def.js'

export * from './table-def.js'
export * from './client-document-def.js'
export * from './EventDef.js'

// TODO adjust return table types to remove write-capabilities from query builder API
export const makeState = <TStateInput extends InputState>(inputSchema: TStateInput): State => {
  // ): Types.Simplify<FromInputState.FromInputState<FromInputState.ToTablesRecord<TStateInput['tables']>>> => {
  const inputTables: ReadonlyArray<TableDef> = Array.isArray(inputSchema.tables)
    ? inputSchema.tables
    : Object.values(inputSchema.tables)

  const tables = new Map<string, TableDef>()

  for (const tableDef of inputTables) {
    const sqliteDef = tableDef.sqliteDef
    // TODO validate tables (e.g. index names are unique)
    if (tables.has(sqliteDef.ast.name)) {
      shouldNeverHappen(`Duplicate table name: ${sqliteDef.ast.name}. Please use unique names for tables.`)
    }
    tables.set(sqliteDef.ast.name, tableDef)
  }

  for (const tableDef of systemTables) {
    tables.set(tableDef.sqliteDef.name, tableDef)
  }

  const materializers = new Map<string, Materializer>()

  for (const [name, materializer] of Object.entries(inputSchema.materializers)) {
    materializers.set(name, materializer)
  }

  materializers.set(rawSqlEvent.name, rawSqlMaterializer)

  for (const tableDef of inputTables) {
    if (tableIsClientDocumentTable(tableDef)) {
      materializers.set(
        tableDef[ClientDocumentTableDefSymbol].derived.setEventDef.name,
        tableDef[ClientDocumentTableDefSymbol].derived.setMaterializer,
      )
    }
  }

  return { tables, materializers }
}

export type InputState = {
  readonly tables: Record<string, TableDefBase | AtomTableDefBase> | ReadonlyArray<TableDefBase | AtomTableDefBase>
  readonly materializers: Record<string, Materializer>
}

export type AtomTableDefBase = { table: TableDefBase }

export type Tables<T extends Record<string, TableDefBase>> = {
  [K in keyof T]: { Row: T[K]['rowSchema']['Type'] }
}

// type State = {
//   readonly tables: Map<string, TableDef>
//   readonly materializers: Map<string, Materializer>
// }

export type Queryable<TTableDef extends TableDefBase> = QueryBuilder<
  ReadonlyArray<TTableDef['rowSchema']['Type']>,
  TTableDef
> & {
  rowSchema: TTableDef['rowSchema']
}

export type QueryableSingle<TTableDef extends TableDefBase> = QueryBuilder<
  TTableDef['rowSchema']['Type'],
  TTableDef
> & {
  rowSchema: TTableDef['rowSchema']
}
// type Queryable<TSchema extends Schema.Schema<any>, > = QueryBuilder<ReadonlyArray<Schema.Schema.Type<TSchema>>, TableDefBase<TSqliteDef & {}, TOptions>>

export namespace FromInputState {
  // export type DeriveSchema<TInputSchema extends InputState> = <
  //   DbSchemaFromInputSchemaTables<TInputSchema['tables']>,
  //   EventDefRecordFromInputSchemaEvents<TInputSchema['materializers']>
  // >

  // export type FromInputState<TTables extends InputState['tables']> =
  //   (TTables extends ReadonlyArray<TableDefBase>
  //     ? { [K in TTables[number] as K['sqliteDef']['name']]: Queryable<K> }
  //     : TTables extends Record<string, TableDefBase>
  //       ? { [K in keyof TTables as TTables[K]['sqliteDef']['name']]: Queryable<TTables[K]> }
  //       : never)

  // export type FromInputState<TTables extends Record<string, TableDefBase>> = {
  //   tables: Map<string, TableDef>
  // }

  // export type FromInputState<TTables extends Record<string, TableDefBase>> = {
  //   query: {
  //     [K in keyof TTables as TTables[K]['sqliteDef']['name']]: Queryable<TTables[K]>
  //   }
  //   atoms: {
  //     [K in keyof TTables as TTables[K]['sqliteDef']['name']]: QueryableSingle<TTables[K]>
  //   }
  //   ['Tables']: {
  //     [K in keyof TTables as TTables[K]['sqliteDef']['name']]: {
  //       Row: TTables[K]['schema']['Type']
  //       Insert: TTables[K]['insertSchema']['Type']
  //     }
  //   }
  // }

  export type ToTablesRecord<TTables extends InputState['tables']> =
    TTables extends ReadonlyArray<TableDefBase | AtomTableDefBase>
      ? {
          [K in TTables[number] as K extends AtomTableDefBase
            ? K['table']['sqliteDef']['name']
            : K extends TableDefBase
              ? K['sqliteDef']['name']
              : never]: K extends AtomTableDefBase ? K['table'] : K extends TableDefBase ? K : never
        }
      : TTables extends Record<string, TableDefBase | AtomTableDefBase>
        ? {
            [K in keyof TTables as TTables[K] extends TableDefBase
              ? TTables[K]['sqliteDef']['name']
              : never]: TTables[K] extends AtomTableDefBase
              ? TTables[K]['table']
              : TTables[K] extends TableDefBase
                ? TTables[K]
                : never
          }
        : never

  export type ToTablesRecord2<TTables extends InputState['tables']> =
    TTables extends ReadonlyArray<TableDefBase>
      ? { [K in TTables[number] as K['sqliteDef']['name']]: K }
      : TTables extends Record<string, TableDefBase>
        ? TTables
        : never
}
