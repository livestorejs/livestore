import * as Schema from '@effect/schema/Schema'

import type { Prettify } from '../../utils.js'
// TODO get rid of `_` suffix once Bun bug is fixed
// `SyntaxError: Cannot declare an imported binding name twice: 'FieldType'.`
import * as FieldType_ from './field-type.js'

export type GetFieldTypeDecoded<TFieldType extends FieldType_.FieldType<any, any, any>> =
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

export const isColumnDefinition = (value: unknown): value is ColumnDefinition<any, any> => {
  const validColumnTypes = ['text', 'integer', 'real', 'blob'] as const
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value['type'] === 'object' &&
    value['type'] !== null &&
    'columnType' in value['type'] &&
    validColumnTypes.includes(value['type']['columnType'] as any)
  )
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
  ({
    // TODO improve handling of nullable schemas
    type: FieldType_.text(def?.nullable === true ? (Schema.nullable(Schema.string) as any) : Schema.string),
    ...def,
  }) as ColumnDefinition<
    FieldType_.FieldTypeText<string, string>,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const textWithSchema = <
  TEncoded extends string,
  TDecoded,
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeText<TEncoded, TDecoded>, boolean>, 'type'>>,
>(
  schema: Schema.Schema<TEncoded, TDecoded>,
  def?: TDef,
) =>
  ({
    // TODO improve handling of nullable schemas
    type: FieldType_.text(def?.nullable === true ? (Schema.nullable(schema) as any) : schema),
    ...def,
  }) as any as ColumnDefinition<
    FieldType_.FieldTypeText<TEncoded, TDecoded>,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const integer = <
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeInteger<number, number>, boolean>, 'type'>>,
>(
  def?: TDef,
) =>
  ({
    // TODO improve handling of nullable schemas
    type: FieldType_.integer(
      def?.nullable === true ? (Schema.nullable(Schema.int()(Schema.number)) as any) : Schema.int()(Schema.number),
    ),
    ...def,
  }) as ColumnDefinition<
    FieldType_.FieldTypeInteger<number, number>,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

export const real = <
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeReal<number, number>, boolean>, 'type'>>,
>(
  def?: TDef,
) =>
  ({
    // TODO improve handling of nullable schemas
    type: FieldType_.real(def?.nullable === true ? (Schema.nullable(Schema.number) as any) : Schema.number),
    ...def,
  }) as ColumnDefinition<
    FieldType_.FieldTypeReal<number, number>,
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

export const json = <
  TEncoded,
  TDecoded,
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeJson<TDecoded>, boolean>, 'type'>>,
>({
  schema,
  ...def
}: TDef & {
  schema: Schema.Schema<TEncoded, TDecoded>
}) =>
  ({ type: FieldType_.json<TEncoded, TDecoded>(schema), ...def }) as ColumnDefinition<
    FieldType_.FieldTypeJson<TDecoded>,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >

// export const json = <From, To, TNullable extends boolean = false>({
//   schema,
//   ...def
// }: { schema: Schema.Schema<From, To> } & Omit<ColumnDefinition<FieldType_.FieldTypeJson<To>, TNullable>, 'type'>) => ({
//   type: FieldType_.json(schema),
//   ...def,
// })

export const datetime = <
  const TDef extends Prettify<Omit<ColumnDefinition<FieldType_.FieldTypeDateTime, boolean>, 'type'>>,
>(
  def?: TDef,
) =>
  ({ type: FieldType_.datetime(), ...def }) as ColumnDefinition<
    FieldType_.FieldTypeDateTime,
    TDef['nullable'] extends boolean ? TDef['nullable'] : false
  >
