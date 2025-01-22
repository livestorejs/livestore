import type { SessionIdSymbol } from './adapter-types.js'
import type { DbSchema } from './schema/mod.js'

/**
 * Semantic information about a query with supported cases being:
 * - a whole row
 * - a single column value
 * - a sub value in a JSON column
 *
 * This information is currently only used for derived mutations.
 */
export type QueryInfo = QueryInfo.None | QueryInfo.Row | QueryInfo.Col | QueryInfo.ColJsonValue
// export type QueryInfo<TTableDef extends DbSchema.TableDefBase = DbSchema.TableDefBase> =
// | QueryInfo.None
// | QueryInfo.Row<TTableDef>
// | QueryInfo.ColJsonValue<TTableDef, GetJsonColumn<TTableDef>>
// | QueryInfo.Col<TTableDef, keyof TTableDef['sqliteDef']['columns']>

export namespace QueryInfo {
  export type None = {
    _tag: 'None'
  }

  export type Row = {
    _tag: 'Row'
    table: DbSchema.TableDefBase
    id: string | SessionIdSymbol
  }

  export type Col = {
    _tag: 'Col'
    table: DbSchema.TableDefBase
    id: string | SessionIdSymbol
    column: string
  }

  export type ColJsonValue = {
    _tag: 'ColJsonValue'
    table: DbSchema.TableDefBase
    id: string | SessionIdSymbol
    column: string
    /**
     * example: `$.tabs[3].items[2]` (`$` referring to the column value)
     */
    jsonPath: string
  }

  // NOTE maybe we want to bring back type-params back like below
  // export type Row<TTableDef extends DbSchema.TableDefBase> = {
  //   _tag: 'Row'
  //   table: TTableDef
  //   id: string | SessionIdSymbol
  // }

  // export type Col<TTableDef extends DbSchema.TableDefBase, TColName extends keyof TTableDef['sqliteDef']['columns']> = {
  //   _tag: 'Col'
  //   table: TTableDef
  //   id: string | SessionIdSymbol
  //   column: TColName
  // }

  // export type ColJsonValue<TTableDef extends DbSchema.TableDefBase, TColName extends GetJsonColumn<TTableDef>> = {
  //   _tag: 'ColJsonValue'
  //   table: TTableDef
  //   id: string | SessionIdSymbol
  //   column: TColName
  //   /**
  //    * example: `$.tabs[3].items[2]` (`$` referring to the column value)
  //    */
  //   jsonPath: string
  // }
}

// type GetJsonColumn<TTableDef extends DbSchema.TableDefBase> = keyof {
//   [ColName in keyof TTableDef['sqliteDef']['columns'] as TTableDef['sqliteDef']['columns'][ColName]['columnType'] extends 'text'
//     ? ColName
//     : never]: {}
// }
