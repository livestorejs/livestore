import { shouldNeverHappen } from '@livestore/utils'
import { pipe, ReadonlyRecord, Schema } from '@livestore/utils/effect'

import { SqliteDsl } from './db-schema/mod.ts'
import type { TableDef, TableDefBase } from './table-def.ts'

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
    ReadonlyRecord.map((column, columnName) => {
      if (fallbackValues?.[columnName] !== undefined) return fallbackValues[columnName]
      if (column!.default._tag === 'None') {
        return column!.nullable === true
          ? null
          : shouldNeverHappen(`Column ${columnName} has no default value and is not nullable`)
      }

      const defaultValue = column!.default.value
      const resolvedDefault = SqliteDsl.resolveColumnDefault(defaultValue)

      return Schema.encodeSync(column!.schema)(resolvedDefault)
    }),
  )

export const getDefaultValuesDecoded = <TTableDef extends TableDefBase>(
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
    ReadonlyRecord.map((column, columnName) => {
      if (fallbackValues?.[columnName] !== undefined) return fallbackValues[columnName]
      if (column!.default._tag === 'None') {
        return column!.nullable === true
          ? null
          : shouldNeverHappen(`Column ${columnName} has no default value and is not nullable`)
      }

      const defaultValue = column!.default.value
      const resolvedDefault = SqliteDsl.resolveColumnDefault(defaultValue)

      return Schema.validateSync(column!.schema)(resolvedDefault)
    }),
  )
