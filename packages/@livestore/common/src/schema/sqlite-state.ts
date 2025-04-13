import { shouldNeverHappen } from '@livestore/utils'

import { ClientDocumentTableDefSymbol, tableIsClientDocumentTable } from './client-document-def.js'
import { type Materializer, rawSqlEvent, rawSqlMaterializer } from './EventDef.js'
import type { State } from './schema.js'
import { systemTables } from './system-tables.js'
import { type TableDef, type TableDefBase } from './table-def.js'

export * from './table-def.js'
export {
  ClientDocumentTableDefSymbol,
  tableIsClientDocumentTable,
  clientDocument,
  type ClientDocumentTableDef,
  type ClientDocumentTableOptions,
} from './client-document-def.js'
export * from './EventDef.js'

export const makeState = <TStateInput extends InputState>(inputSchema: TStateInput): State => {
  const inputTables: ReadonlyArray<TableDef> = Array.isArray(inputSchema.tables)
    ? inputSchema.tables
    : Object.values(inputSchema.tables)

  const tables = new Map<string, TableDef.Any>()

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

  const materializers = new Map<string, Materializer<any>>()

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
  readonly tables: Record<string, TableDefBase> | ReadonlyArray<TableDefBase>
  readonly materializers: Record<string, Materializer<any>>
}
