import type { StateSetters } from './react/useRow.js'
import type { LiveStoreJSQuery } from './reactiveQueries/js.js'
import type { RowQueryOptions, RowQueryOptionsDefaulValues, RowResult } from './row-query.js'
import type { DefaultSqliteTableDef, TableDef, TableOptions } from './schema/table-def.js'

/**
 * A description of a path to update a value either ...
 * - as a whole row
 * - or a single column value
 * - or a sub value in a JSON column
 */
export type UpdatePathDesc = {
  table: TableDef
  id: string
  column?: string
  /**
   * example: `$.tabs[3].items[2]` (`$` referring to the column value)
   */
  jsonPath?: string
}

export type MakeRowState = {
  <TTableDef extends TableDef<DefaultSqliteTableDef, boolean, TableOptions & { isSingleton: true }>>(
    table: TTableDef,
    options?: RowQueryOptions,
  ): [query: LiveStoreJSQuery<RowResult<TTableDef>>, setRow: StateSetters<TTableDef>]
  <TTableDef extends TableDef<DefaultSqliteTableDef, boolean, TableOptions & { isSingleton: false }>>(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string,
    options?: RowQueryOptions & RowQueryOptionsDefaulValues<TTableDef>,
  ): [query: LiveStoreJSQuery<RowResult<TTableDef>>, setRow: StateSetters<TTableDef>]
}

export const rowState: MakeRowState = <TTableDef extends TableDef>(
  table: TTableDef,
  idOrOptions?: string | RowQueryOptions,
  options_?: RowQueryOptions & RowQueryOptionsDefaulValues<TTableDef>,
) => {
  return null as any
}
