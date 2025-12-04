import { casesHandled } from '@livestore/utils'
import { Option, Schema } from '@livestore/utils/effect'

export type SqlDefaultValue = {
  readonly sql: string
}

export const isSqlDefaultValue = (value: unknown): value is SqlDefaultValue => {
  return typeof value === 'object' && value !== null && 'sql' in value && typeof (value as any).sql === 'string'
}

export type ColumnDefaultThunk<T> = () => T

export const isDefaultThunk = (value: unknown): value is ColumnDefaultThunk<unknown> => typeof value === 'function'

export type ColumnDefaultValue<T> = T | null | ColumnDefaultThunk<T | null> | SqlDefaultValue

export const resolveColumnDefault = <T>(value: ColumnDefaultValue<T>): T | null | SqlDefaultValue =>
  isDefaultThunk(value) ? (value as ColumnDefaultThunk<T | null>)() : value

export type ColumnDefinition<TEncoded, TDecoded> = {
  readonly columnType: FieldColumnType
  readonly schema: Schema.Schema<TDecoded, TEncoded>
  readonly default: Option.Option<ColumnDefaultValue<TDecoded>>
  /** @default false */
  readonly nullable: boolean
  /** @default false */
  readonly primaryKey: boolean
  /** @default false */
  readonly autoIncrement: boolean
}

export declare namespace ColumnDefinition {
  export type Any = ColumnDefinition<any, any>
}

export const isColumnDefinition = (value: unknown): value is ColumnDefinition.Any => {
  const validColumnTypes = ['text', 'integer', 'real', 'blob'] as const
  return (
    typeof value === 'object' &&
    value !== null &&
    'columnType' in value &&
    validColumnTypes.includes(value.columnType as any)
  )
}

type MaybeNull<T, TNullable extends boolean> = T | (TNullable extends true ? null : never)

type ColumnDefaultArg<T, TNullable extends boolean> =
  | MaybeNull<T, TNullable>
  | ColumnDefaultThunk<MaybeNull<T, TNullable>>
  | SqlDefaultValue
  | NoDefault

export type ColumnDefinitionInput = {
  readonly schema?: Schema.Schema<unknown>
  readonly default?: ColumnDefaultArg<unknown, boolean>
  readonly nullable?: boolean
  readonly primaryKey?: boolean
  readonly autoIncrement?: boolean
}

export const NoDefault = Symbol.for('NoDefault')
export type NoDefault = typeof NoDefault

export type ColDefFn<TColumnType extends FieldColumnType> = {
  (): {
    columnType: TColumnType
    schema: Schema.Schema<DefaultEncodedForColumnType<TColumnType>>
    default: Option.None<never>
    nullable: false
    primaryKey: false
    autoIncrement: false
  }
  <
    TEncoded extends DefaultEncodedForColumnType<TColumnType>,
    TDecoded = DefaultEncodedForColumnType<TColumnType>,
    const TNullable extends boolean = false,
    const TDefault extends ColumnDefaultArg<NoInfer<TDecoded>, TNullable> = NoDefault,
    const TPrimaryKey extends boolean = false,
    const TAutoIncrement extends boolean = false,
  >(args: {
    schema?: Schema.Schema<TDecoded, TEncoded>
    default?: TDefault
    nullable?: TNullable
    primaryKey?: TPrimaryKey
    autoIncrement?: TAutoIncrement
  }): {
    columnType: TColumnType
    schema: TNullable extends true
      ? Schema.Schema<NoInfer<TDecoded> | null, NoInfer<TEncoded> | null>
      : Schema.Schema<NoInfer<TDecoded>, NoInfer<TEncoded>>
    default: TDefault extends NoDefault ? Option.None<never> : Option.Some<NoInfer<TDefault>>
    nullable: NoInfer<TNullable>
    primaryKey: NoInfer<TPrimaryKey>
    autoIncrement: NoInfer<TAutoIncrement>
  }
}

const makeColDef =
  <TColumnType extends FieldColumnType>(columnType: TColumnType): ColDefFn<TColumnType> =>
  (def?: ColumnDefinitionInput) => {
    const nullable = def?.nullable ?? false
    const schemaWithoutNull: Schema.Schema<any> = def?.schema ?? defaultSchemaForColumnType(columnType)
    const schema = nullable === true ? Schema.NullOr(schemaWithoutNull) : schemaWithoutNull
    const default_ = def?.default === undefined || def.default === NoDefault ? Option.none() : Option.some(def.default)

    return {
      columnType,
      schema,
      default: default_,
      nullable,
      primaryKey: def?.primaryKey ?? false,
      autoIncrement: def?.autoIncrement ?? false,
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
    schema: Schema.Schema<TBaseDecoded, DefaultEncodedForColumnType<TColumnType>>
    default: Option.None<never>
    nullable: false
    primaryKey: false
    autoIncrement: false
  }
  <
    TDecoded = TBaseDecoded,
    const TNullable extends boolean = false,
    const TDefault extends ColumnDefaultArg<NoInfer<TDecoded>, TNullable> = NoDefault,
    const TPrimaryKey extends boolean = false,
    const TAutoIncrement extends boolean = false,
  >(
    args: TAllowsCustomSchema extends true
      ? {
          schema?: Schema.Schema<TDecoded, any>
          default?: TDefault
          nullable?: TNullable
          primaryKey?: TPrimaryKey
          autoIncrement?: TAutoIncrement
        }
      : {
          default?: TDefault
          nullable?: TNullable
          primaryKey?: TPrimaryKey
          autoIncrement?: TAutoIncrement
        },
  ): {
    columnType: TColumnType
    schema: TNullable extends true
      ? Schema.Schema<NoInfer<TDecoded> | null, DefaultEncodedForColumnType<TColumnType> | null>
      : Schema.Schema<NoInfer<TDecoded>, DefaultEncodedForColumnType<TColumnType>>
    default: TDefault extends NoDefault ? Option.None<never> : Option.Some<TDefault>
    nullable: NoInfer<TNullable>
    primaryKey: NoInfer<TPrimaryKey>
    autoIncrement: NoInfer<TAutoIncrement>
  }
}

type MakeSpecializedColDefFn = {
  <TColumnType extends FieldColumnType, TBaseDecoded>(
    columnType: TColumnType,
    opts: {
      _tag: 'baseSchema'
      baseSchema: Schema.Schema<TBaseDecoded, DefaultEncodedForColumnType<TColumnType>>
    },
  ): SpecializedColDefFn<TColumnType, false, TBaseDecoded>
  <TColumnType extends FieldColumnType, TBaseDecoded>(
    columnType: TColumnType,
    opts: {
      _tag: 'baseSchemaFn'
      baseSchemaFn: <TDecoded>(
        customSchema: Schema.Schema<TDecoded, TBaseDecoded> | undefined,
      ) => Schema.Schema<TBaseDecoded, DefaultEncodedForColumnType<TColumnType>>
    },
  ): SpecializedColDefFn<TColumnType, true, TBaseDecoded>
}

const makeSpecializedColDef: MakeSpecializedColDefFn = (columnType, opts) => (def?: ColumnDefinitionInput) => {
  const nullable = def?.nullable ?? false
  const schemaWithoutNull = opts._tag === 'baseSchemaFn' ? opts.baseSchemaFn(def?.schema as any) : opts.baseSchema
  const schema = nullable === true ? Schema.NullOr(schemaWithoutNull) : schemaWithoutNull
  const default_ = def?.default === undefined || def.default === NoDefault ? Option.none() : Option.some(def.default)

  return {
    columnType,
    schema,
    default: default_,
    nullable,
    primaryKey: def?.primaryKey ?? false,
    autoIncrement: def?.autoIncrement ?? false,
  } as any
}

export const json: SpecializedColDefFn<'text', true, unknown> = makeSpecializedColDef('text', {
  _tag: 'baseSchemaFn',
  baseSchemaFn: (customSchema) => Schema.parseJson(customSchema ?? Schema.Any),
})

export const datetime: SpecializedColDefFn<'text', false, Date> = makeSpecializedColDef('text', {
  _tag: 'baseSchema',
  baseSchema: Schema.Date,
})

export const datetimeInteger: SpecializedColDefFn<'integer', false, Date> = makeSpecializedColDef('integer', {
  _tag: 'baseSchema',
  baseSchema: Schema.transform(Schema.Number, Schema.DateFromSelf, {
    decode: (ms) => new Date(ms),
    encode: (date) => date.getTime(),
  }),
})

export const boolean: SpecializedColDefFn<'integer', false, boolean> = makeSpecializedColDef('integer', {
  _tag: 'baseSchema',
  baseSchema: Schema.transform(Schema.Number, Schema.Boolean, {
    decode: (_) => _ === 1,
    encode: (_) => (_ ? 1 : 0),
  }),
})

export type FieldColumnType = 'text' | 'integer' | 'real' | 'blob'

export type DefaultEncodedForColumnType<TColumnType extends FieldColumnType> = TColumnType extends 'text'
  ? string
  : TColumnType extends 'integer'
    ? number
    : TColumnType extends 'real'
      ? number
      : TColumnType extends 'blob'
        ? Uint8Array<ArrayBuffer>
        : never

export const defaultSchemaForColumnType = <TColumnType extends FieldColumnType>(
  columnType: TColumnType,
): Schema.Schema<DefaultEncodedForColumnType<TColumnType>> => {
  type T = DefaultEncodedForColumnType<TColumnType>

  switch (columnType) {
    case 'text': {
      return Schema.String as any as Schema.Schema<T>
    }
    case 'integer': {
      return Schema.Number as any as Schema.Schema<T>
    }
    case 'real': {
      return Schema.Number as any as Schema.Schema<T>
    }
    case 'blob': {
      return Schema.Uint8ArrayFromSelf as any as Schema.Schema<T>
    }
    default: {
      return casesHandled(columnType)
    }
  }
}
