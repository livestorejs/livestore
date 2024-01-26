import * as Schema from '@effect/schema/Schema'
import { absurd, Option } from 'effect'

export type ColumnDefinition<TEncoded, TDecoded> = {
  readonly columnType: FieldColumnType
  readonly schema: Schema.Schema<never, TEncoded, TDecoded>
  readonly default: Option.Option<TEncoded>
  /** @default false */
  readonly nullable: boolean
  /** @default false */
  readonly primaryKey: boolean
}

export const isColumnDefinition = (value: unknown): value is ColumnDefinition<any, any> => {
  const validColumnTypes = ['text', 'integer', 'real', 'blob'] as const
  return (
    typeof value === 'object' &&
    value !== null &&
    'columnType' in value &&
    validColumnTypes.includes(value['columnType'] as any)
  )
}

export type ColumnDefinitionInput = {
  readonly schema?: Schema.Schema<never, unknown, unknown>
  readonly default?: unknown | NoDefault
  readonly nullable?: boolean
  readonly primaryKey?: boolean
}

export const NoDefault = Symbol.for('NoDefault')
export type NoDefault = typeof NoDefault

export type ColDefFn<TColumnType extends FieldColumnType> = {
  (): {
    columnType: TColumnType
    schema: Schema.Schema<never, DefaultEncodedForColumnType<TColumnType>, DefaultEncodedForColumnType<TColumnType>>
    default: Option.None<never>
    nullable: false
    primaryKey: false
  }
  <
    TEncoded extends DefaultEncodedForColumnType<TColumnType>,
    TDecoded = DefaultEncodedForColumnType<TColumnType>,
    const TNullable extends boolean = false,
    const TDefault extends TDecoded | NoDefault | (TNullable extends true ? null : never) = NoDefault,
    const TPrimaryKey extends boolean = false,
  >(args: {
    schema?: Schema.Schema<never, TEncoded, TDecoded>
    default?: TDefault
    nullable?: TNullable
    primaryKey?: TPrimaryKey
  }): {
    columnType: TColumnType
    schema: TNullable extends true
      ? Schema.Schema<never, NoInfer<TEncoded> | null, NoInfer<TDecoded> | null>
      : Schema.Schema<never, NoInfer<TEncoded>, NoInfer<TDecoded>>
    default: TDefault extends NoDefault ? Option.None<never> : Option.Some<NoInfer<TDefault>>
    nullable: NoInfer<TNullable>
    primaryKey: NoInfer<TPrimaryKey>
  }
}

const makeColDef =
  <TColumnType extends FieldColumnType>(columnType: TColumnType): ColDefFn<TColumnType> =>
  (def?: ColumnDefinitionInput) => {
    const nullable = def?.nullable ?? false
    const schemaWithoutNull: Schema.Schema<never, any, any> = def?.schema ?? defaultSchemaForColumnType(columnType)
    const schema = nullable === true ? Schema.nullable(schemaWithoutNull) : schemaWithoutNull
    const default_ = def?.default === undefined || def.default === NoDefault ? Option.none() : Option.some(def.default)

    return {
      columnType,
      schema,
      default: default_,
      nullable,
      primaryKey: def?.primaryKey ?? false,
    } as any
  }

export const column = <TColumnType extends FieldColumnType>(columnType: TColumnType): ColDefFn<TColumnType> =>
  makeColDef(columnType)

/// Column definitions

export const text: ColDefFn<'text'> = makeColDef('text')
export const integer: ColDefFn<'integer'> = makeColDef('integer')
export const real: ColDefFn<'real'> = makeColDef('real')
export const blob: ColDefFn<'blob'> = makeColDef('blob')

/**
 * `NoInfer` is needed for some generics to work properly in certain cases.
 * See full explanation here: https://gist.github.com/schickling/a15e96819826530492b41a10d79d3c04?permalink_comment_id=4805120#gistcomment-4805120
 *
 * Big thanks to @andarist for their help with this!
 */
type NoInfer<T> = [T][T extends any ? 0 : never]

export type SpecializedColDefFn<
  TColumnType extends FieldColumnType,
  TAllowsCustomSchema extends boolean,
  TBaseDecoded,
> = {
  (): {
    columnType: TColumnType
    schema: Schema.Schema<never, DefaultEncodedForColumnType<TColumnType>, TBaseDecoded>
    default: Option.None<never>
    nullable: false
    primaryKey: false
  }
  <
    TDecoded = TBaseDecoded,
    const TNullable extends boolean = false,
    const TDefault extends TDecoded | NoDefault | (TNullable extends true ? null : never) = NoDefault,
    const TPrimaryKey extends boolean = false,
  >(
    args: TAllowsCustomSchema extends true
      ? {
          schema?: Schema.Schema<never, any, TDecoded>
          default?: TDefault
          nullable?: TNullable
          primaryKey?: TPrimaryKey
        }
      : {
          default?: TDefault
          nullable?: TNullable
          primaryKey?: TPrimaryKey
        },
  ): {
    columnType: TColumnType
    schema: TNullable extends true
      ? Schema.Schema<never, DefaultEncodedForColumnType<TColumnType> | null, NoInfer<TDecoded> | null>
      : Schema.Schema<never, DefaultEncodedForColumnType<TColumnType>, NoInfer<TDecoded>>
    default: TDefault extends NoDefault ? Option.None<never> : Option.Some<TDefault>
    nullable: NoInfer<TNullable>
    primaryKey: NoInfer<TPrimaryKey>
  }
}

type MakeSpecializedColDefFn = {
  <TColumnType extends FieldColumnType, TBaseDecoded>(
    columnType: TColumnType,
    baseSchema: Schema.Schema<never, DefaultEncodedForColumnType<TColumnType>, TBaseDecoded>,
  ): SpecializedColDefFn<TColumnType, false, TBaseDecoded>
  <TColumnType extends FieldColumnType, TBaseDecoded>(
    columnType: TColumnType,
    baseSchema: <TDecoded>(
      customSchema: Schema.Schema<never, TBaseDecoded, TDecoded> | undefined,
    ) => Schema.Schema<never, DefaultEncodedForColumnType<TColumnType>, TBaseDecoded>,
  ): SpecializedColDefFn<TColumnType, true, TBaseDecoded>
}

const makeSpecializedColDef: MakeSpecializedColDefFn = (columnType, baseSchema) => (def?: ColumnDefinitionInput) => {
  const nullable = def?.nullable ?? false
  const schemaWithoutNull = typeof baseSchema === 'function' ? baseSchema(def?.schema as any) : baseSchema
  const schema = nullable === true ? Schema.nullable(schemaWithoutNull) : schemaWithoutNull
  const default_ = def?.default === undefined || def.default === NoDefault ? Option.none() : Option.some(def.default)

  return {
    columnType,
    schema,
    default: default_,
    nullable,
    primaryKey: def?.primaryKey ?? false,
  } as any
}

export const json: SpecializedColDefFn<'text', true, unknown> = makeSpecializedColDef('text', (customSchema) =>
  Schema.parseJson(customSchema ?? Schema.any),
)

export const datetime: SpecializedColDefFn<'text', false, Date> = makeSpecializedColDef('text', Schema.Date)

export const datetimeInteger: SpecializedColDefFn<'integer', false, Date> = makeSpecializedColDef(
  'integer',
  Schema.transform(
    Schema.number,
    Schema.DateFromSelf,
    (x) => new Date(x),
    (x) => x.getTime(),
  ),
)

export const boolean: SpecializedColDefFn<'integer', false, boolean> = makeSpecializedColDef(
  'integer',
  Schema.transform(
    Schema.number,
    Schema.boolean,
    (_) => _ === 1,
    (_) => (_ ? 1 : 0),
  ),
)

export type FieldColumnType = 'text' | 'integer' | 'real' | 'blob'

export type DefaultEncodedForColumnType<TColumnType extends FieldColumnType> = TColumnType extends 'text'
  ? string
  : TColumnType extends 'integer'
    ? number
    : TColumnType extends 'real'
      ? number
      : TColumnType extends 'blob'
        ? Uint8Array
        : never

export const defaultSchemaForColumnType = <TColumnType extends FieldColumnType>(
  columnType: TColumnType,
): Schema.Schema<never, DefaultEncodedForColumnType<TColumnType>, DefaultEncodedForColumnType<TColumnType>> => {
  type T = DefaultEncodedForColumnType<TColumnType>

  switch (columnType) {
    case 'text': {
      return Schema.string as any as Schema.Schema<never, T, T>
    }
    case 'integer': {
      return Schema.number as any as Schema.Schema<never, T, T>
    }
    case 'real': {
      return Schema.number as any as Schema.Schema<never, T, T>
    }
    case 'blob': {
      return Schema.Uint8ArrayFromSelf as any as Schema.Schema<never, T, T>
    }
    default: {
      return absurd(columnType)
    }
  }
}
