import { shouldNeverHappen } from '@livestore/utils'

import type { MigrationOptions } from '../../../adapter-types.ts'
import type { Materializer } from '../../EventDef/mod.ts'
import type { InternalState } from '../../schema.ts'
import { SqliteAst } from './db-schema/mod.ts'
import { stateSystemTables } from './system-tables/state-tables.ts'
import type { TableDef, TableDefBase } from './table-def.ts'

export * from '../../EventDef/mod.ts'
export * from './column-annotations.ts'
export * from './column-spec.ts'
export * from './table-def.ts'

export const makeState = <TStateInput extends InputState>(inputSchema: TStateInput): InternalState => {
  const inputTables: ReadonlyArray<TableDef> =
    Array.isArray(inputSchema.tables) === true ? inputSchema.tables : Object.values(inputSchema.tables)

  const tables = new Map<string, TableDef.Any>()

  for (const tableDef of inputTables) {
    const sqliteDef = tableDef.sqliteDef
    // TODO validate tables (e.g. index names are unique)
    if (tables.has(sqliteDef.ast.name) === true) {
      shouldNeverHappen(`Duplicate table name: ${sqliteDef.ast.name}. Please use unique names for tables.`)
    }
    tables.set(sqliteDef.ast.name, tableDef)
  }

  for (const tableDef of stateSystemTables) {
    tables.set(tableDef.sqliteDef.name, tableDef)
  }

  const materializers = new Map<string, Materializer<any>>()

  for (const [name, materializer] of Object.entries(inputSchema.materializers)) {
    materializers.set(name, materializer)
  }

  const hash = SqliteAst.hash({
    _tag: 'dbSchema',
    tables: [...tables.values()].map((_) => _.sqliteDef.ast),
  })

  return { sqlite: { tables, migrations: inputSchema.migrations ?? { strategy: 'auto' }, hash }, materializers }
}

export type InputState = {
  readonly tables: Record<string, TableDefBase> | ReadonlyArray<TableDefBase>
  readonly materializers: Record<string, Materializer<any>>
  /**
   * @default { strategy: 'auto' }
   */
  readonly migrations?: MigrationOptions
}
