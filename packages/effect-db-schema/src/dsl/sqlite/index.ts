import type * as Schema from '@effect/schema/Schema'

import type * as SqliteAst from '../../ast/sqlite.js'
import * as FieldType from './field-type.js'

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

const indexesToAst = (_indexes: Index[]): SqliteAst.Index[] => {
  // TODO
  return []
}

export type DbSchema = { [key: string]: TableDefinition<string, Columns> }

type GetFieldTypeDecoded<TFieldType extends FieldType.FieldType<any, any, any>> =
  TFieldType extends FieldType.FieldType<any, any, infer TDecoded> ? TDecoded : never

export type ColumnDefinition<
  TFieldType extends FieldType.FieldType<FieldType.FieldColumnType, any, any>,
  TNullable extends boolean,
> = {
  readonly type: TFieldType
  /** Value needs to be decoded (e.g. `Date` instead of `number`) */
  readonly default?: GetFieldTypeDecoded<TFieldType>
  /** @default false */
  readonly nullable?: TNullable
  readonly primaryKey?: boolean
}

/// Column definitions

export const column = <TType extends FieldType.FieldColumnType, TEncoded, TDecoded, TNullable extends boolean>(
  _: ColumnDefinition<FieldType.FieldType<TType, TEncoded, TDecoded>, TNullable>,
) => _

export const text = <TNullable extends boolean>(
  _?: Omit<ColumnDefinition<FieldType.FieldType<'text', string, string>, TNullable>, 'type'>,
) => ({ type: FieldType.text(), ..._ })

export const integer = <TNullable extends boolean>(
  _?: Omit<ColumnDefinition<FieldType.FieldType<'integer', string, string>, TNullable>, 'type'>,
) => ({ type: FieldType.integer(), ..._ })

export const real = <TNullable extends boolean>(
  _?: Omit<ColumnDefinition<FieldType.FieldType<'real', string, string>, TNullable>, 'type'>,
) => ({ type: FieldType.real(), ..._ })

export const blob = <TNullable extends boolean>(
  _?: Omit<ColumnDefinition<FieldType.FieldType<'blob', string, string>, TNullable>, 'type'>,
) => ({ type: FieldType.blob(), ..._ })

export const blobWithSchema = <TDecoded, TNullable extends boolean>({
  schema,
  ..._
}: { schema: Schema.Schema<Uint8Array, TDecoded> } & Omit<
  ColumnDefinition<FieldType.FieldType<'blob', string, string>, TNullable>,
  'type'
>) => ({ type: FieldType.blobWithCodec(schema), ..._ })

export const boolean = <const TNullable extends boolean>(
  _?: Omit<ColumnDefinition<FieldType.FieldType<'integer', number, boolean>, TNullable>, 'type'>,
) => ({ type: FieldType.boolean(), ..._ })

export const json = <From, To, TNullable extends boolean>({
  schema,
  ..._
}: { schema: Schema.Schema<From, To> } & Omit<
  ColumnDefinition<FieldType.FieldType<'text', string, string>, TNullable>,
  'type'
>) => ({ type: FieldType.json(schema), ..._ })

export const datetime = <TNullable extends boolean>(
  _?: Omit<ColumnDefinition<FieldType.FieldType<'integer', number, Date>, TNullable>, 'type'>,
) => ({ type: FieldType.datetime(), ..._ })

/// Other

export type TableDefinition<TName extends string, TColumns extends Columns> = {
  name: TName
  columns: TColumns
  indexes?: Index[]
  ast: SqliteAst.Table
}

export type Columns = Record<
  string,
  ColumnDefinition<FieldType.FieldType<FieldType.FieldColumnType, any, any>, boolean>
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

export type GetRowDecoded<TTableDefinition extends TableDefinition<any, any>> = PrettifyFlat<
  Partial<Pick<GetRowDecodedAll<TTableDefinition>, GetNullableColumnNames<TTableDefinition['columns']>>> &
    Omit<GetRowDecodedAll<TTableDefinition>, GetNullableColumnNames<TTableDefinition['columns']>>
>

export type GetNullableColumnNames<TColumns extends Columns> = keyof {
  [K in keyof TColumns as TColumns[K] extends ColumnDefinition<any, true> ? K : never]: {}
}
