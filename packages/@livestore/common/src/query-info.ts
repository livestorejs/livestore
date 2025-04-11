import type { SessionIdSymbol } from './adapter-types.js'
import type { State } from './schema/mod.js'

/**
 * Semantic information about a query with supported cases being:
 * - a whole row
 * - a single column value
 * - a sub value in a JSON column
 *
 * This information is currently only used for derived mutations.
 */
export type QueryInfo = QueryInfo.None | QueryInfo.Row | QueryInfo.Col | QueryInfo.ColJsonValue | QueryInfo.Write
// export type QueryInfo<TTableDef extends State.SQLite.TableDefBase = State.SQLite.TableDefBase> =
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
    table: State.SQLite.TableDefBase
    id: string | SessionIdSymbol | number
  }

  export type Col = {
    _tag: 'Col'
    table: State.SQLite.TableDefBase
    id: string | SessionIdSymbol | number
    column: string
  }

  export type ColJsonValue = {
    _tag: 'ColJsonValue'
    table: State.SQLite.TableDefBase
    id: string | SessionIdSymbol | number
    column: string
    /**
     * example: `$.tabs[3].items[2]` (`$` referring to the column value)
     */
    jsonPath: string
  }

  // NOTE Not yet used but we might want to use this in order to avoid write queries in read-only situations
  export type Write = {
    _tag: 'Write'
  }

  // NOTE maybe we want to bring back type-params back like below
  // export type Row<TTableDef extends State.SQLite.TableDefBase> = {
  //   _tag: 'Row'
  //   table: TTableDef
  //   id: string | SessionIdSymbol
  // }

  // export type Col<TTableDef extends State.SQLite.TableDefBase, TColName extends keyof TTableDef['sqliteDef']['columns']> = {
  //   _tag: 'Col'
  //   table: TTableDef
  //   id: string | SessionIdSymbol
  //   column: TColName
  // }

  // export type ColJsonValue<TTableDef extends State.SQLite.TableDefBase, TColName extends GetJsonColumn<TTableDef>> = {
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

// type GetJsonColumn<TTableDef extends State.SQLite.TableDefBase> = keyof {
//   [ColName in keyof TTableDef['sqliteDef']['columns'] as TTableDef['sqliteDef']['columns'][ColName]['columnType'] extends 'text'
//     ? ColName
//     : never]: {}
// }
