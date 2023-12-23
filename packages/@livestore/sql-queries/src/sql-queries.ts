import { Schema } from '@effect/schema'
import { pipe, ReadonlyArray } from 'effect'
import type { SqliteDsl } from 'effect-db-schema'

import { objectEntries, sql } from './misc.js'
import * as ClientTypes from './types.js'

export type BindValues = {
  readonly [columnName: string]: any
}

export const findManyRows = <TColumns extends SqliteDsl.Columns>({
  columns,
  tableName,
  where,
  limit,
}: {
  tableName: string
  columns: TColumns
  where: ClientTypes.WhereValuesForColumns<TColumns>
  limit?: number
}): [string, BindValues] => {
  const whereSql = buildWhereSql({ where })
  const whereModifier = whereSql === '' ? '' : `WHERE ${whereSql}`
  const limitModifier = limit ? `LIMIT ${limit}` : ''

  const whereBindValues = makeBindValues({ columns, values: where, variablePrefix: 'where_', skipNil: true })

  return [sql`SELECT * FROM ${tableName} ${whereModifier} ${limitModifier}`, whereBindValues]
}

export const countRows = <TColumns extends SqliteDsl.Columns>({
  columns,
  tableName,
  where,
}: {
  tableName: string
  columns: TColumns
  where: ClientTypes.WhereValuesForColumns<TColumns>
}): [string, BindValues] => {
  const whereSql = buildWhereSql({ where })
  const whereModifier = whereSql === '' ? '' : `WHERE ${whereSql}`

  const whereBindValues = makeBindValues({ columns, values: where, variablePrefix: 'where_', skipNil: true })

  return [sql`SELECT count(1) FROM ${tableName} ${whereModifier}`, whereBindValues]
}

export const insertRow = <TColumns extends SqliteDsl.Columns>({
  tableName,
  columns,
  values,
  options = { orReplace: false },
}: {
  tableName: string
  columns: TColumns
  values: ClientTypes.DecodedValuesForColumns<TColumns>
  options: { orReplace: boolean }
}): [string, BindValues] => {
  const keysStr = Object.keys(values).join(', ')
  const valuesStr = Object.keys(values)
    .map((_) => `$${_}`)
    .join(', ')

  return [
    sql`INSERT ${options.orReplace ? 'OR REPLACE' : ''} INTO ${tableName} (${keysStr}) VALUES (${valuesStr})`,
    makeBindValues({ columns, values }),
  ]
}

export const insertRows = <TColumns extends SqliteDsl.Columns>({
  columns,
  tableName,
  valuesArray,
}: {
  tableName: string
  columns: TColumns
  valuesArray: ClientTypes.DecodedValuesForColumns<TColumns>[]
}): [string, BindValues] => {
  const keysStr = Object.keys(valuesArray[0]!).join(', ')

  // NOTE consider batching for large arrays (https://sqlite.org/forum/info/f832398c19d30a4a)
  const valuesStrs = valuesArray
    .map((values, itemIndex) =>
      Object.keys(values)
        .map((_) => `$item_${itemIndex}_${_}`)
        .join(', '),
    )
    .map((_) => `(${_})`)
    .join(', ')

  const bindValues = valuesArray.reduce(
    (acc, values, itemIndex) => ({
      ...acc,
      ...makeBindValues({ columns, values, variablePrefix: `item_${itemIndex}_` }),
    }),
    {},
  )

  return [sql`INSERT INTO ${tableName} (${keysStr}) VALUES ${valuesStrs}`, bindValues]
}

export const insertOrIgnoreRow = <TColumns extends SqliteDsl.Columns>({
  columns,
  tableName,
  values: values_,
  returnRow,
}: {
  tableName: string
  columns: TColumns
  values: ClientTypes.DecodedValuesForColumns<TColumns>
  returnRow: boolean
}): [string, BindValues] => {
  const values = filterUndefinedFields(values_)
  const keysStr = Object.keys(values).join(', ')
  const valuesStr = Object.keys(values)
    .map((_) => `$${_}`)
    .join(', ')

  const bindValues = makeBindValues({ columns, values })
  const returningStmt = returnRow ? 'RETURNING *' : ''

  return [sql`INSERT OR IGNORE INTO ${tableName} (${keysStr}) VALUES (${valuesStr}) ${returningStmt}`, bindValues]
}

export const updateRows = <TColumns extends SqliteDsl.Columns>({
  columns,
  tableName,
  updateValues: updateValues_,
  where,
}: {
  columns: TColumns
  tableName: string
  updateValues: Partial<ClientTypes.DecodedValuesForColumnsAll<TColumns>>
  where: ClientTypes.WhereValuesForColumns<TColumns>
}): [string, BindValues] => {
  const updateValues = filterUndefinedFields(updateValues_)

  // TODO return an Option instead of `select 1` if there are no update values
  if (Object.keys(updateValues).length === 0) {
    return [sql`select 1`, {}]
  }

  const updateValueStr = Object.keys(updateValues)
    .map((columnName) => `${columnName} = $update_${columnName}`)
    .join(', ')

  const bindValues = {
    ...makeBindValues({ columns, values: updateValues, variablePrefix: 'update_' }),
    ...makeBindValues({ columns, values: where, variablePrefix: 'where_', skipNil: true }),
  }

  const whereSql = buildWhereSql({ where })
  const whereModifier = whereSql === '' ? '' : `WHERE ${whereSql}`

  return [sql`UPDATE ${tableName} SET ${updateValueStr} ${whereModifier}`, bindValues]
}

export const deleteRows = <TColumns extends SqliteDsl.Columns>({
  columns,
  tableName,
  where,
}: {
  columns: TColumns
  tableName: string
  where: ClientTypes.WhereValuesForColumns<TColumns>
}): [string, BindValues] => {
  const bindValues = {
    ...makeBindValues({ columns, values: where, variablePrefix: 'where_', skipNil: true }),
  }

  const whereSql = buildWhereSql({ where })
  const whereModifier = whereSql === '' ? '' : `WHERE ${whereSql}`

  return [sql`DELETE FROM ${tableName} ${whereModifier}`, bindValues]
}

export const upsertRow = <TColumns extends SqliteDsl.Columns>({
  tableName,
  columns,
  createValues: createValues_,
  updateValues: updateValues_,
  where,
}: {
  tableName: string
  columns: TColumns
  createValues: ClientTypes.DecodedValuesForColumns<TColumns>
  updateValues: Partial<ClientTypes.DecodedValuesForColumnsAll<TColumns>>
  // TODO where VALUES are actually not used here. Maybe adjust API?
  where: ClientTypes.WhereValuesForColumns<TColumns>
}): [string, BindValues] => {
  const createValues = filterUndefinedFields(createValues_)
  const updateValues = filterUndefinedFields(updateValues_)

  const keysStr = Object.keys(createValues).join(', ')

  const createValuesStr = Object.keys(createValues)
    .map((_) => `$create_${_}`)
    .join(', ')

  const conflictStr = Object.keys(where).join(', ')

  const updateValueStr = Object.keys(updateValues)
    .map((columnName) => `${columnName} = $update_${columnName}`)
    .join(', ')

  const bindValues = {
    ...makeBindValues({ columns, values: createValues, variablePrefix: 'create_' }),
    ...makeBindValues({ columns, values: updateValues, variablePrefix: 'update_' }),
  }

  return [
    sql`
      INSERT INTO ${tableName} (${keysStr})
       VALUES (${createValuesStr})
       ON CONFLICT (${conflictStr}) DO UPDATE SET ${updateValueStr}
    `,
    bindValues,
  ]
}

export const createTable = ({
  table,
  tableName,
}: {
  table: SqliteDsl.TableDefinition<any, SqliteDsl.Columns>
  tableName: string
}): string => {
  const primaryKeys = Object.entries(table.columns)
    .filter(([_, columnDef]) => columnDef.primaryKey)
    .map(([columnName, _]) => columnName)
  const columnDefStrs = Object.entries(table.columns).map(([columnName, columnDef]) => {
    const nullModifier = columnDef.nullable === true ? '' : 'NOT NULL'
    const defaultModifier = columnDef.default._tag === 'None' ? '' : `DEFAULT ${columnDef.default.value}`
    return sql`${columnName} ${columnDef.columnType} ${nullModifier} ${defaultModifier}`
  })

  if (primaryKeys.length > 0) {
    columnDefStrs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
  }

  return sql`CREATE TABLE ${tableName} (${columnDefStrs.join(', ')});`
}

export const makeBindValues = <TColumns extends SqliteDsl.Columns, TKeys extends string>({
  columns,
  values,
  variablePrefix = '',
  skipNil,
}: {
  columns: TColumns
  values: Record<TKeys, any>
  variablePrefix?: string
  /** So far only used to prepare `where` statements */
  skipNil?: boolean
}): Record<string, any> => {
  const codecMap = pipe(
    columns,
    objectEntries,
    ReadonlyArray.map(([columnName, columnDef]) => [
      columnName,
      (value: any) =>
        columnDef.nullable === true && (value === null || value === undefined)
          ? null
          : Schema.encodeSync(columnDef.schema)(value),
    ]),
    Object.fromEntries,
  )

  return pipe(
    Object.entries(values)
      // NOTE null/undefined values are handled via explicit SQL syntax and don't need to be provided as bind values
      .filter(([, value]) => skipNil !== true || (value !== null && value !== undefined))
      .flatMap(([columnName, value]: [string, any]) => {
        // remap complex where-values with `op`
        if (typeof value === 'object' && value !== null && 'op' in value) {
          switch (value.op) {
            case 'in': {
              return value.val.map((value: any, i: number) => [
                `${variablePrefix}${columnName}_${i}`,
                codecMap[columnName]!(value),
              ])
            }
            case '=':
            case '>':
            case '<': {
              return [[`${variablePrefix}${columnName}`, codecMap[columnName]!(value.val)]]
            }
            default: {
              throw new Error(`Unknown op: ${value.op}`)
            }
          }
        } else {
          return [[`${variablePrefix}${columnName}`, codecMap[columnName]!(value)]]
        }
      }),
    Object.fromEntries,
  )
}

const buildWhereSql = <TColumns extends SqliteDsl.Columns>({
  where,
}: {
  where: ClientTypes.WhereValuesForColumns<TColumns>
}) => {
  const getWhereOp = (columnName: string, value: ClientTypes.WhereValueForDecoded<any>) => {
    if (value === null) {
      return `IS NULL`
    } else if (typeof value === 'object' && typeof value.op === 'string' && ClientTypes.isValidWhereOp(value.op)) {
      return `${value.op} $where_${columnName}`
    } else if (typeof value === 'object' && typeof value.op === 'string' && value.op === 'in') {
      return `in (${value.val.map((_: any, i: number) => `$where_${columnName}_${i}`).join(', ')})`
    } else {
      return `= $where_${columnName}`
    }
  }

  return pipe(
    where,
    objectEntries,
    ReadonlyArray.map(([columnName, value]) => `${columnName} ${getWhereOp(columnName, value)}`),
    ReadonlyArray.join(' AND '),
  )
}

// TODO better typing
const filterUndefinedFields = <T extends Record<string, any>>(obj: T): T => {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T
}
