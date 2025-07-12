import type { SqliteDsl } from '../schema/state/sqlite/db-schema/mod.ts'
import type { BindValues } from './sql-queries.ts'
import * as SqlQueries from './sql-queries.ts'
import type * as ClientTypes from './types.ts'

export type SqlQuery = [stmt: string, bindValues: BindValues, tableName: string]

export const makeSqlQueryBuilder = <TSchema extends SqliteDsl.DbSchema>(schema: TSchema) => {
  const findManyRows = <TTableName extends keyof TSchema & string>({
    tableName,
    where,
    limit,
  }: {
    tableName: TTableName
    where: ClientTypes.WhereValuesForTable<TSchema, TTableName>
    limit?: number
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.findManyRows({ columns, tableName, where, limit })
    return [stmt, bindValues, tableName]
  }

  const countRows = <TTableName extends keyof TSchema & string>({
    tableName,
    where,
  }: {
    tableName: TTableName
    where: ClientTypes.WhereValuesForTable<TSchema, TTableName>
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.countRows({ columns, tableName, where })
    return [stmt, bindValues, tableName]
  }

  const insertRow = <TTableName extends keyof TSchema & string>({
    tableName,
    values,
    options = { orReplace: false },
  }: {
    tableName: TTableName
    values: ClientTypes.DecodedValuesForTable<TSchema, TTableName>
    options?: { orReplace: boolean }
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.insertRow({ columns, tableName, values, options })
    return [stmt, bindValues, tableName]
  }

  const insertRows = <TTableName extends keyof TSchema & string>({
    tableName,
    valuesArray,
  }: {
    tableName: TTableName
    valuesArray: ClientTypes.DecodedValuesForTable<TSchema, TTableName>[]
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.insertRows({ columns, tableName, valuesArray })
    return [stmt, bindValues, tableName]
  }

  const insertOrIgnoreRow = <TTableName extends keyof TSchema & string>({
    tableName,
    values,
    returnRow = false,
  }: {
    tableName: TTableName
    values: ClientTypes.DecodedValuesForTable<TSchema, TTableName>
    returnRow?: boolean
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.insertOrIgnoreRow({ columns, tableName, values, returnRow })
    return [stmt, bindValues, tableName]
  }

  const updateRows = <TTableName extends keyof TSchema & string>({
    tableName,
    updateValues,
    where,
  }: {
    tableName: TTableName
    updateValues: Partial<ClientTypes.DecodedValuesForTableAll<TSchema, TTableName>>
    where: ClientTypes.WhereValuesForTable<TSchema, TTableName>
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.updateRows({ columns, tableName, updateValues, where })
    return [stmt, bindValues, tableName]
  }

  const deleteRows = <TTableName extends keyof TSchema & string>({
    tableName,
    where,
  }: {
    tableName: TTableName
    where: ClientTypes.WhereValuesForTable<TSchema, TTableName>
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.deleteRows({ columns, tableName, where })
    return [stmt, bindValues, tableName]
  }

  const upsertRow = <TTableName extends keyof TSchema & string>({
    tableName,
    createValues,
    updateValues,
    where,
  }: {
    tableName: TTableName
    createValues: ClientTypes.DecodedValuesForTable<TSchema, TTableName>
    updateValues: Partial<ClientTypes.DecodedValuesForTableAll<TSchema, TTableName>>
    // TODO where VALUES are actually not used here. Maybe adjust API?
    where: ClientTypes.WhereValuesForTable<TSchema, TTableName>
  }): [string, BindValues, TTableName] => {
    const columns = schema[tableName]!.columns
    const [stmt, bindValues] = SqlQueries.upsertRow({
      columns,
      tableName,
      createValues: createValues as any, // TODO investigate why types don't match
      updateValues,
      where,
    })
    return [stmt, bindValues, tableName]
  }

  return {
    findManyRows,
    countRows,
    insertRow,
    insertRows,
    insertOrIgnoreRow,
    updateRows,
    deleteRows,
    upsertRow,
  }
}
