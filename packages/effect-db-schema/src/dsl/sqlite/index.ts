import * as Schema from '@effect/schema/Schema'

import type * as SqliteAst from '../../ast/sqlite.js'
// TODO get rid of `_` suffix once Bun bug is fixed
// `SyntaxError: Cannot declare an imported binding name twice: 'FieldType'.`
import * as FieldType_ from './field-type.js'

export * as FieldType from './field-type.js'

// TODO ensure via runtime check (possibly even via type-level check) that all index names are unique
export const defineDbSchema = <S extends DbSchema>(schema: S) => schema

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

export const structSchemaForTable = <TTableDefinition extends TableDefinition<any, any>>(tableDef: TTableDefinition) =>
  Schema.struct(Object.fromEntries(tableDef.ast.columns.map((column) => [column.name, column.codec])))

const columsToAst = (columns: Columns): SqliteAst.Column[] => {
  return Object.entries(columns).map(([name, column]) => {
    return {
      _tag: 'column',
      name,
      codec: column.type.codec,
      default: column.default,
      nullable: column.nullable,
      primaryKey: column.primaryKey ?? false,
      type: { _tag: column.type.columnType },
    } satisfies SqliteAst.Column
  })
}

const indexesToAst = (indexes: Index[]): SqliteAst.Index[] => {
  return indexes.map(
    (_) => ({ _tag: 'index', columns: _.columns, name: _.name, unique: _.isUnique ?? false }) satisfies SqliteAst.Index,
  )
}

export type DbSchema = { [key: string]: TableDefinition<string, Columns> }

type GetFieldTypeDecoded<TFieldType extends FieldType_.FieldType<any, any, any>> =
  TFieldType extends FieldType_.FieldType<any, any, infer TDecoded> ? TDecoded : never

export interface ColumnDefinition<
  TFieldType extends FieldType_.FieldType<FieldType_.FieldColumnType, any, any>,
  TNullable extends boolean,
> {
  readonly type: TFieldType
  // TODO don't allow `null` for non-nullable columns
  /** Value needs to be decoded (e.g. `Date` instead of `number`) */
  readonly default?: GetFieldTypeDecoded<TFieldType> | null
  /** @default false */
  readonly nullable?: TNullable
  readonly primaryKey?: boolean
}

/// Column definitions

export const column = <TType extends FieldType_.FieldColumnType, TEncoded, TDecoded, TNullable extends boolean>(
  _: ColumnDefinition<FieldType_.FieldType<TType, TEncoded, TDecoded>, TNullable>,
) => _

export const text = <
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeText<string, string>, boolean>, 'type'>>,
>(
  def?: TDef,
) =>
  ({ type: FieldType_.text(Schema.string), ...def }) as ColumnDefinition<
    FieldType_.FieldTypeText<string, string>,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const textWithSchema = <
  TEncoded extends string,
  TDecoded extends string,
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeText<TEncoded, TDecoded>, boolean>, 'type'>>,
>(
  schema: Schema.Schema<TEncoded, TDecoded>,
  def?: TDef,
) =>
  ({ type: FieldType_.text(schema), ...def }) as any as ColumnDefinition<
    FieldType_.FieldTypeText<TEncoded, TDecoded>,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const integer = <
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeInteger, boolean>, 'type'>>,
>(
  def?: TDef,
) =>
  ({ type: FieldType_.integer(), ...def }) as ColumnDefinition<
    FieldType_.FieldTypeInteger,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const real = <const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeReal, boolean>, 'type'>>>(
  def?: TDef,
) =>
  ({ type: FieldType_.real(), ...def }) as ColumnDefinition<
    FieldType_.FieldTypeReal,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const blob = <TNullable extends boolean = false>(
  def?: Omit<ColumnDefinition<FieldType_.FieldTypeBlob<Uint8Array>, TNullable>, 'type'>,
) => ({ type: FieldType_.blob(), ...def })

export const blobWithSchema = <TDecoded, TNullable extends boolean = false>({
  schema,
  ...def
}: { schema: Schema.Schema<Uint8Array, TDecoded> } & Omit<
  ColumnDefinition<FieldType_.FieldTypeBlob<TDecoded>, TNullable>,
  'type'
>) => ({ type: FieldType_.blobWithCodec(schema), ...def })

export const boolean = <
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeBoolean, boolean>, 'type'>>,
>(
  def?: TDef,
) =>
  ({ type: FieldType_.boolean(), ...def }) as ColumnDefinition<
    FieldType_.FieldTypeBoolean,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const json = <From, To, TNullable extends boolean = false>({
  schema,
  ...def
}: { schema: Schema.Schema<From, To> } & Omit<ColumnDefinition<FieldType_.FieldTypeJson<To>, TNullable>, 'type'>) => ({
  type: FieldType_.json(schema),
  ...def,
})

export const datetime = <TNullable extends boolean = false>(
  def?: Omit<ColumnDefinition<FieldType_.FieldTypeDateTime, TNullable>, 'type'>,
) => ({ type: FieldType_.datetime(), ...def })

/// Other

export type TableDefinition<TName extends string, TColumns extends Columns> = {
  name: TName
  columns: TColumns
  indexes?: Index[]
  ast: SqliteAst.Table
}

export type Columns = Record<
  string,
  ColumnDefinition<FieldType_.FieldType<FieldType_.FieldColumnType, any, any>, boolean>
>

export type Index = {
  name: string
  columns: string[]
  /** @default false */
  isUnique?: boolean
}

export type Prettify<T> = T extends infer U ? { [K in keyof U]: Prettify<U[K]> } : never
export type PrettifyFlat<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

export type GetColumns<TTableDefinition extends TableDefinition<any, any>> = {
  [K in keyof TTableDefinition['columns']]: TTableDefinition['columns'][K]['type']['columnType']
}

export type GetRowEncodedAll<TTableDefinition extends TableDefinition<any, any>> = {
  [K in keyof TTableDefinition['columns']]: Schema.Schema.From<TTableDefinition['columns'][K]['type']['codec']>
}

export type GetRowEncoded<TTableDefinition extends TableDefinition<any, any>> = PrettifyFlat<
  Partial<Pick<GetRowEncodedAll<TTableDefinition>, GetNullableColumnNames<TTableDefinition['columns']>>> &
    Omit<GetRowEncodedAll<TTableDefinition>, GetNullableColumnNames<TTableDefinition['columns']>>
>

export type GetRowDecodedAll<TTableDefinition extends TableDefinition<any, any>> = {
  [K in keyof TTableDefinition['columns']]: Schema.Schema.To<TTableDefinition['columns'][K]['type']['codec']>
}

// TODO this sometimes doesn't preserve the order of columns
// export type GetRowDecodedFromColumns<TColumns extends Columns> = PrettifyFlat<
//   Partial<Pick<GetRowDecodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>> &
//     Omit<GetRowDecodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>
// >
// export type GetRowDecodedFromColumns<TColumns extends Columns> = PrettifyFlat<
//   Partial<Pick<GetRowDecodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>> &
//     Omit<GetRowDecodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>
// >

export type Nullable<T> = { [K in keyof T]: T[K] | null }

export type GetRowDecodedFromColumns<TColumns extends Columns> = PrettifyFlat<
  Nullable<Pick<GetRowDecodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>> &
    Omit<GetRowDecodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>
>

export type GetRowDecodedAllFromColumns<TColumns extends Columns> = {
  [K in keyof TColumns]: Schema.Schema.To<TColumns[K]['type']['codec']>
}

export type GetRowEncodedFromColumns<TColumns extends Columns> = PrettifyFlat<
  Nullable<Pick<GetRowEncodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>> &
    Omit<GetRowEncodedAllFromColumns<TColumns>, GetNullableColumnNames<TColumns>>
>

export type GetRowEncodedAllFromColumns<TColumns extends Columns> = {
  [K in keyof TColumns]: Schema.Schema.From<TColumns[K]['type']['codec']>
}

// TODO this sometimes doesn't preserve the order of columns
export type GetRowDecoded<TTableDefinition extends TableDefinition<any, any>> = PrettifyFlat<
  Partial<Pick<GetRowDecodedAll<TTableDefinition>, GetNullableColumnNames<TTableDefinition['columns']>>> &
    Omit<GetRowDecodedAll<TTableDefinition>, GetNullableColumnNames<TTableDefinition['columns']>>
>

export type GetNullableColumnNames<TColumns extends Columns> = keyof {
  [K in keyof TColumns as TColumns[K] extends ColumnDefinition<any, true> ? K : never]: {}
}
