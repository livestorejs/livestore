import { SqliteDsl } from '@livestore/db-schema'
import { shouldNeverHappen } from '@livestore/utils'
import { pipe, ReadonlyRecord, Schema } from '@livestore/utils/effect'

import type { TableDef } from './table-def.js'

export const getDefaultValuesEncoded = <TTableDef extends TableDef>(
  tableDef: TTableDef,
  fallbackValues?: Record<string, any>,
) =>
  pipe(
    tableDef.sqliteDef.columns,
    ReadonlyRecord.filter((col, key) => {
      if (fallbackValues?.[key] !== undefined) return true
      if (key === 'id') return false
      return col!.default._tag === 'None' || SqliteDsl.isSqlDefaultValue(col!.default.value) === false
    }),
    ReadonlyRecord.map((column, columnName) =>
      fallbackValues?.[columnName] === undefined
        ? column!.default._tag === 'None'
          ? column!.nullable === true
            ? null
            : shouldNeverHappen(`Column ${columnName} has no default value and is not nullable`)
          : Schema.encodeSync(column!.schema)(column!.default.value)
        : fallbackValues[columnName],
    ),
  )

export const getDefaultValuesDecoded = <TTableDef extends TableDef>(
  tableDef: TTableDef,
  fallbackValues?: Record<string, any>,
) =>
  pipe(
    tableDef.sqliteDef.columns,
    ReadonlyRecord.filter((col, key) => {
      if (fallbackValues?.[key] !== undefined) return true
      if (key === 'id') return false
      return col!.default._tag === 'None' || SqliteDsl.isSqlDefaultValue(col!.default.value) === false
    }),
    ReadonlyRecord.map((column, columnName) =>
      fallbackValues?.[columnName] === undefined
        ? column!.default._tag === 'None'
          ? column!.nullable === true
            ? null
            : shouldNeverHappen(`Column ${columnName} has no default value and is not nullable`)
          : Schema.validateSync(column!.schema)(column!.default.value)
        : fallbackValues[columnName],
    ),
  )
