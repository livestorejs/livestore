import { shouldNeverHappen } from '@livestore/utils'
import type { ReadonlyArray } from '@livestore/utils/effect'
import { pipe, ReadonlyRecord, Schema, TreeFormatter } from '@livestore/utils/effect'
import { SqliteDsl as __SqliteDsl } from 'effect-db-schema'

import { getDefaultValuesDecoded } from './schema-helpers.js'
import { type FromColumns, type FromTable, type TableDef } from './table-def.js'

export const many = <TTableDef extends TableDef>(
  table: TTableDef,
): ((rawRows: ReadonlyArray<any>) => ReadonlyArray<FromTable.RowDecoded<TTableDef>>) => {
  return Schema.decodeSync(Schema.Array(table.schema)) as TODO
}

export const first =
  <TTableDef extends TableDef>(
    table: TTableDef,
    fallback?: FromColumns.InsertRowDecoded<TTableDef['sqliteDef']['columns']>,
  ) =>
  (rawRows: ReadonlyArray<any>) => {
    const rows = Schema.decodeSync(Schema.Array(table.schema))(rawRows)

    if (rows.length === 0) {
      const schemaDefaultValues = getDefaultValuesDecoded(table)

      const defaultValuesResult = pipe(
        table.sqliteDef.columns,
        ReadonlyRecord.map((_column, columnName) => (fallback as any)?.[columnName] ?? schemaDefaultValues[columnName]),
        Schema.validateEither(table.schema),
      )

      if (defaultValuesResult._tag === 'Right') {
        return defaultValuesResult.right
      } else {
        console.error('decode error', TreeFormatter.formatErrorSync(defaultValuesResult.left))
        return shouldNeverHappen(
          `Expected query (for table ${table.sqliteDef.name}) to return at least one result but found none. Also can't fallback to default values as some were not provided.`,
        )
      }
    }

    return rows[0]!
  }
