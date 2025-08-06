import type { Nullable } from '@livestore/utils'
import type { Option, Types } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import type * as SqliteAst from '../ast/sqlite.js'
import type { ColumnDefinition } from './field-defs.js'

export * from './field-defs.js'

export type DbSchema = {
  [key: string]: TableDefinition<string, Columns>
}

/** Note when using the object-notation, the object keys are ignored and not used as table names */
export type DbSchemaInput = Record<string, TableDefinition<any, any>> | ReadonlyArray<TableDefinition<any, any>>

/**
 * In case of ...
 * - array: we use the table name of each array item (= table definition) as the object key
 * - object: we discard the keys of the input object and use the table name of each object value (= table definition) as the new object key
 */
export type DbSchemaFromInputSchema<TSchemaInput extends DbSchemaInput> =
  TSchemaInput extends ReadonlyArray<TableDefinition<any, any>>
    ? { [K in TSchemaInput[number] as K['name']]: K }
    : TSchemaInput extends Record<string, TableDefinition<any, any>>
      ? { [K in keyof TSchemaInput as TSchemaInput[K]['name']]: TSchemaInput[K] }
      : never

// TODO ensure via runtime check (possibly even via type-level check) that all index names are unique
export const makeDbSchema = <TDbSchemaInput extends DbSchemaInput>(
  schema: TDbSchemaInput,
): DbSchemaFromInputSchema<TDbSchemaInput> => {
  return Array.isArray(schema) ? Object.fromEntries(schema.map((_) => [_.name, _])) : (schema as any)
}

export const table = <TTableName extends string, TColumns extends Columns, TIndexes extends Index[]>(
  name: TTableName,
  columns: TColumns,
  indexes?: TIndexes,
): TableDefinition<TTableName, TColumns> => {
  const ast: SqliteAst.Table = {
    _tag: 'table',
    name,
    columns: columsToAst(columns),
    indexes: indexesToAst(indexes ?? []),
  }

  return { name, columns, indexes, ast }
}

export type AnyIfConstained<In, Out> = '__constrained' extends keyof In ? any : Out
export type EmptyObjIfConstained<In> = '__constrained' extends keyof In ? {} : In

export type StructSchemaForColumns<TCols extends ConstraintColumns> = Schema.Schema<
  AnyIfConstained<TCols, FromColumns.RowDecoded<TCols>>,
  AnyIfConstained<TCols, FromColumns.RowEncoded<TCols>>
>

export type InsertStructSchemaForColumns<TCols extends ConstraintColumns> = Schema.Schema<
  AnyIfConstained<TCols, FromColumns.InsertRowDecoded<TCols>>,
  AnyIfConstained<TCols, FromColumns.InsertRowEncoded<TCols>>
>

export const structSchemaForTable = <TTableDefinition extends TableDefinition<any, any>>(
  tableDef: TTableDefinition,
): StructSchemaForColumns<TTableDefinition['columns']> =>
  Schema.Struct(Object.fromEntries(tableDef.ast.columns.map((column) => [column.name, column.schema]))).annotations({
    title: tableDef.name,
  }) as any

export const insertStructSchemaForTable = <TTableDefinition extends TableDefinition<any, any>>(
  tableDef: TTableDefinition,
): InsertStructSchemaForColumns<TTableDefinition['columns']> =>
  Schema.Struct(
    Object.fromEntries(
      tableDef.ast.columns.map((column) => [
        column.name,
        column.nullable === true || column.default._tag === 'Some' ? Schema.optional(column.schema) : column.schema,
      ]),
    ),
  ).annotations({
    title: tableDef.name,
  }) as any

const columsToAst = (columns: Columns): ReadonlyArray<SqliteAst.Column> => {
  return Object.entries(columns).map(([name, column]) => {
    return {
      _tag: 'column',
      name,
      schema: column.schema,
      default: column.default as any,
      nullable: column.nullable ?? false,
      primaryKey: column.primaryKey ?? false,
      type: { _tag: column.columnType },
    } satisfies SqliteAst.Column
  })
}

const indexesToAst = (indexes: ReadonlyArray<Index>): ReadonlyArray<SqliteAst.Index> => {
  return indexes.map(
    (_) => ({ _tag: 'index', columns: _.columns, name: _.name, unique: _.isUnique ?? false }) satisfies SqliteAst.Index,
  )
}

/// Other

export type TableDefinition<TName extends string, TColumns extends Columns> = {
  name: TName
  columns: TColumns
  indexes?: ReadonlyArray<Index> | undefined
  ast: SqliteAst.Table
}

export type Columns = Record<string, ColumnDefinition<any, any>>

export type IsSingleColumn<TColumns extends Columns | ColumnDefinition<any, any>> =
  TColumns extends ColumnDefinition<any, any> ? true : false

/**
 * NOTE this is only needed to avoid a TS limitation where `StructSchemaForColumns` in the default case
 * results in `Record<string, any>` instead of `any`. (Thanks to Andarist for the workaround)
 *
 * Hopefully this can be removed in the future
 */
export type ConstraintColumns = Record<string, ColumnDefinition<any, any>> & { __constrained?: never }

export type Index = {
  name: string
  columns: ReadonlyArray<string>
  /** @default false */
  isUnique?: boolean
}

export namespace FromTable {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TTableDefinition extends TableDefinition<any, any>> = Types.Simplify<
    Nullable<Pick<RowDecodedAll<TTableDefinition>, NullableColumnNames<TTableDefinition>>> &
      Omit<RowDecodedAll<TTableDefinition>, NullableColumnNames<TTableDefinition>>
  >

  export type NullableColumnNames<TTableDefinition extends TableDefinition<any, any>> = FromColumns.NullableColumnNames<
    TTableDefinition['columns']
  >

  export type Columns<TTableDefinition extends TableDefinition<any, any>> = {
    [K in keyof TTableDefinition['columns']]: TTableDefinition['columns'][K]['columnType']
  }

  export type RowEncodeNonNullable<TTableDefinition extends TableDefinition<any, any>> = {
    [K in keyof TTableDefinition['columns']]: Schema.Schema.Encoded<TTableDefinition['columns'][K]['schema']>
  }

  export type RowEncoded<TTableDefinition extends TableDefinition<any, any>> = Types.Simplify<
    Nullable<Pick<RowEncodeNonNullable<TTableDefinition>, NullableColumnNames<TTableDefinition>>> &
      Omit<RowEncodeNonNullable<TTableDefinition>, NullableColumnNames<TTableDefinition>>
  >

  // export type RowEncoded<TTableDefinition extends TableDefinition<any, any>> = NullableColumnNames<
  //   TTableDefinition['columns']
  // >

  //   &
  //     Omit<RowEncodeNonNullable<TTableDefinition>, NullableColumnNames<TTableDefinition['columns']>>
  // >

  export type RowDecodedAll<TTableDefinition extends TableDefinition<any, any>> = {
    [K in keyof TTableDefinition['columns']]: Schema.Schema.Type<TTableDefinition['columns'][K]['schema']>
  }
}

export namespace FromColumns {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TColumns extends Columns> = Types.Simplify<
    Nullable<Pick<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowDecodedAll<TColumns extends Columns> = {
    readonly [K in keyof TColumns]: Schema.Schema.Type<TColumns[K]['schema']>
  }

  export type RowEncodedAll<TColumns extends Columns> = {
    readonly [K in keyof TColumns]: Schema.Schema.Encoded<TColumns[K]['schema']>
  }

  export type RowEncoded<TColumns extends Columns> = Types.Simplify<
    Nullable<Pick<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowEncodeNonNullable<TColumns extends Columns> = {
    readonly [K in keyof TColumns]: Schema.Schema.Encoded<TColumns[K]['schema']>
  }

  export type NullableColumnNames<TColumns extends Columns> = keyof {
    // TODO double check why there is a `true` in the type
    [K in keyof TColumns as TColumns[K] extends ColumnDefinition<any, true> ? K : never]: {}
  }

  export type RequiredInsertColumns<TColumns extends Columns> = {
    [K in keyof TColumns as TColumns[K]['nullable'] extends true
      ? never
      : TColumns[K]['default'] extends Option.Some<any>
        ? never
        : K]: {}
  }

  export type RequiredInsertColumnNames<TColumns extends Columns> = keyof RequiredInsertColumns<TColumns>

  export type RequiresInsertValues<TColumns extends Columns> =
    RequiredInsertColumnNames<TColumns> extends never ? false : true

  export type InsertRowDecoded<TColumns extends Columns> = Types.Simplify<
    Pick<RowDecodedAll<TColumns>, RequiredInsertColumnNames<TColumns>> &
      Partial<Omit<RowDecodedAll<TColumns>, RequiredInsertColumnNames<TColumns>>>
  >

  export type InsertRowEncoded<TColumns extends Columns> = Types.Simplify<
    Pick<RowEncodedAll<TColumns>, RequiredInsertColumnNames<TColumns>> &
      Partial<Omit<RowEncodedAll<TColumns>, RequiredInsertColumnNames<TColumns>>>
  >
}
