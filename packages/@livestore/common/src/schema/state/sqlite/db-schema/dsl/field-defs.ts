import { casesHandled } from '@livestore/utils'
import { type Option, Schema, type SchemaAST } from '@livestore/utils/effect'

import { SqliteReal } from '../../../../../util.ts'
import {
  AutoIncrement,
  type ColumnDefault,
  type ColumnDefaultThunk,
  type ColumnDefaultValue,
  ColumnType,
  constructorDefaultFor,
  Default,
  isSqlDefaultValue,
  PrimaryKeyId,
  type SqlDefaultValue,
} from '../../column-annotations.ts'

export {
  type ColumnDefaultThunk,
  type ColumnDefaultValue,
  constructorDefaultFor,
  isDefaultThunk,
  isSqlDefaultValue,
  resolveColumnDefault,
  type SqlDefaultValue,
} from '../../column-annotations.ts'

/**
 * The SQLite-level view of one table column. Derived from the column's field schema (see
 * `getColumnDefForSchema`) and consumed by DDL generation, migrations and the query builder. It is
 * not what users build by hand anymore: `State.SQLite.text()` & co. return field schemas.
 */
export type ColumnDefinition<TEncoded, TDecoded, TNullable extends boolean = boolean> = {
  readonly columnType: FieldColumnType
  readonly schema: Schema.Codec<TDecoded, TEncoded>
  readonly default: Option.Option<ColumnDefaultValue<TDecoded>>
  /** @default false */
  readonly nullable: TNullable
  /** @default false */
  readonly primaryKey: boolean
  /** @default false */
  readonly autoIncrement: boolean
}

export declare namespace ColumnDefinition {
  export type Any = ColumnDefinition<any, any>
}

type MaybeNull<T, TNullable extends boolean> = T | (TNullable extends true ? null : never)

type ColumnDefaultArg<T, TNullable extends boolean> =
  | MaybeNull<T, TNullable>
  | ColumnDefaultThunk<MaybeNull<T, TNullable>>
  | SqlDefaultValue
  | NoDefault

export type ColumnDefinitionInput = {
  readonly schema?: Schema.Top | undefined
  readonly default?: ColumnDefaultArg<unknown, boolean>
  readonly nullable?: boolean | undefined
  readonly primaryKey?: boolean | undefined
  readonly autoIncrement?: boolean | undefined
}

export const NoDefault = Symbol.for('NoDefault')
export type NoDefault = typeof NoDefault

/**
 * A column field schema. The column's SQLite facets are encoded as Effect constructs where one
 * exists, so they show up in the schema's type and in `rowSchema.make`:
 *
 * - `nullable: true` wraps the schema in `Schema.NullOr`
 * - `default` attaches an Effect constructor default (`~type.constructor.default: 'with-default'`),
 *   which is what makes the column omittable in `insert()`
 *
 * Everything else (column type, primary key, auto increment, the default value for DDL) lives in
 * `livestore/state/sqlite/annotations/*` annotations, read back by `getColumnDefForSchema`.
 */
export type ColumnSchema<S extends Schema.Top, TNullable extends boolean, TDefault> = WithColumnDefault<
  TNullable extends true ? Schema.NullOr<S> : S,
  TDefault
>

export type WithColumnDefault<S extends Schema.Top, TDefault> = [TDefault] extends [NoDefault]
  ? S
  : ColumnDefault<S & Schema.WithoutConstructorDefault>

/**
 * The call signatures are split by whether a custom `schema` is given: TypeScript would otherwise
 * let the contextual type of the surrounding `columns` object win over the type parameter's default
 * and infer `Schema.Top` for helper calls without a schema.
 */
export type ColDefFn<TColumnType extends FieldColumnType> = {
  (): DefaultSchemaForColumnType<TColumnType>
  <
    const TNullable extends boolean = false,
    const TDefault extends ColumnDefaultArg<NoInfer<DefaultSchemaForColumnType<TColumnType>['Type']>, TNullable> =
      NoDefault,
    const TPrimaryKey extends boolean = false,
    const TAutoIncrement extends boolean = false,
  >(args: {
    schema?: undefined
    default?: TDefault
    nullable?: TNullable
    primaryKey?: TPrimaryKey
    autoIncrement?: TAutoIncrement
  }): ColumnSchema<DefaultSchemaForColumnType<TColumnType>, TNullable, TDefault>
  <
    TSchema extends Schema.Codec<any, DefaultEncodedForColumnType<TColumnType>>,
    const TNullable extends boolean = false,
    const TDefault extends ColumnDefaultArg<NoInfer<TSchema['Type']>, TNullable> = NoDefault,
    const TPrimaryKey extends boolean = false,
    const TAutoIncrement extends boolean = false,
  >(args: {
    /** Must encode to the column's SQLite value type */
    schema: TSchema
    default?: TDefault
    nullable?: TNullable
    primaryKey?: TPrimaryKey
    autoIncrement?: TAutoIncrement
  }): ColumnSchema<TSchema, TNullable, TDefault>
}

const makeColDef =
  <TColumnType extends FieldColumnType>(columnType: TColumnType): ColDefFn<TColumnType> =>
  (def?: ColumnDefinitionInput) =>
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- column factory return type uses complex conditional generics; consumer type safety enforced by ColDefFn signature
    makeColumnSchema(columnType, def?.schema ?? defaultSchemaForColumnType(columnType), def) as any

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
  TBase extends Schema.Top,
> = {
  (): TBase
  <
    const TNullable extends boolean = false,
    const TDefault extends ColumnDefaultArg<NoInfer<TBase['Type']>, TNullable> = NoDefault,
    const TPrimaryKey extends boolean = false,
    const TAutoIncrement extends boolean = false,
  >(
    args: { schema?: undefined } & ColumnFacetsArgs<TBase['Type'], TNullable, TDefault, TPrimaryKey, TAutoIncrement>,
  ): ColumnSchema<TBase, TNullable, TDefault>
} & (TAllowsCustomSchema extends true
  ? {
      <
        TSchema extends Schema.Top,
        const TNullable extends boolean = false,
        const TDefault extends ColumnDefaultArg<NoInfer<TSchema['Type']>, TNullable> = NoDefault,
        const TPrimaryKey extends boolean = false,
        const TAutoIncrement extends boolean = false,
      >(
        args: { schema: TSchema } & ColumnFacetsArgs<TSchema['Type'], TNullable, TDefault, TPrimaryKey, TAutoIncrement>,
      ): ColumnSchema<Schema.fromJsonString<TSchema>, TNullable, TDefault>
    }
  : {})

type MakeSpecializedColDefFn = {
  <TColumnType extends FieldColumnType, TBase extends Schema.Top>(
    columnType: TColumnType,
    opts: { _tag: 'baseSchema'; baseSchema: TBase },
  ): SpecializedColDefFn<TColumnType, false, TBase>
  <TColumnType extends FieldColumnType, TBase extends Schema.Top>(
    columnType: TColumnType,
    opts: {
      _tag: 'baseSchemaFn'
      baseSchemaFn: (customSchema: Schema.Top | undefined) => Schema.Top
    },
  ): SpecializedColDefFn<TColumnType, true, TBase>
}

const makeSpecializedColDef: MakeSpecializedColDefFn = (columnType, opts) => (def?: ColumnDefinitionInput) => {
  const base = opts._tag === 'baseSchemaFn' ? opts.baseSchemaFn(def?.schema) : opts.baseSchema
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- specialized column factory return type uses complex conditional generics; consumer type safety enforced by SpecializedColDefFn signature
  return makeColumnSchema(columnType, base, def) as any
}

/** Without a custom schema the decoded value is `unknown`; a JSON column never declares a shape it does not validate. */
export const json: SpecializedColDefFn<'text', true, Schema.fromJsonString<Schema.Unknown>> = makeSpecializedColDef<
  'text',
  Schema.fromJsonString<Schema.Unknown>
>('text', {
  _tag: 'baseSchemaFn',
  baseSchemaFn: (customSchema) => Schema.fromJsonString(customSchema ?? Schema.Any),
})

export const datetime: SpecializedColDefFn<'text', false, Schema.DateFromString> = makeSpecializedColDef('text', {
  _tag: 'baseSchema',
  baseSchema: Schema.DateFromString,
})

export const datetimeInteger: SpecializedColDefFn<'integer', false, Schema.DateFromMillis> = makeSpecializedColDef(
  'integer',
  {
    _tag: 'baseSchema',
    baseSchema: Schema.DateFromMillis,
  },
)

export const boolean: SpecializedColDefFn<'integer', false, Schema.BooleanFromBit> = makeSpecializedColDef('integer', {
  _tag: 'baseSchema',
  baseSchema: Schema.BooleanFromBit,
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

export type DefaultSchemaForColumnType<TColumnType extends FieldColumnType> = TColumnType extends 'text'
  ? Schema.String
  : TColumnType extends 'integer'
    ? Schema.Finite
    : TColumnType extends 'real'
      ? typeof SqliteReal
      : TColumnType extends 'blob'
        ? SqliteBlob
        : never

/** `Schema.Uint8Array` narrowed to `ArrayBuffer`-backed arrays, which is what SQLite bind values require */
export interface SqliteBlob extends Schema.Bottom<
  Uint8Array<ArrayBuffer>,
  Uint8Array<ArrayBuffer>,
  never,
  never,
  SchemaAST.Declaration,
  SqliteBlob
> {}

// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- narrows the buffer type only; same runtime schema
export const SqliteBlob: SqliteBlob = Schema.Uint8Array as any as SqliteBlob

export const defaultSchemaForColumnType = <TColumnType extends FieldColumnType>(
  columnType: TColumnType,
): DefaultSchemaForColumnType<TColumnType> => {
  type T = DefaultSchemaForColumnType<TColumnType>

  switch (columnType) {
    case 'text': {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- switch-based type narrowing for column type to schema mapping; each case is correct for its branch
      return Schema.String as T
    }
    case 'integer': {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- switch-based type narrowing for column type to schema mapping; each case is correct for its branch
      return Schema.Finite as T
    }
    case 'real': {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- switch-based type narrowing for column type to schema mapping; each case is correct for its branch
      return SqliteReal as T
    }
    case 'blob': {
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- switch-based type narrowing for column type to schema mapping; each case is correct for its branch
      return SqliteBlob as T
    }
    default: {
      return casesHandled(columnType)
    }
  }
}

/**
 * Builds the field schema for a column. `nullable` becomes `Schema.NullOr`, the SQLite facets become
 * annotations, and a `default` becomes an Effect constructor default so `rowSchema.make` fills it in
 * and the type system knows the field is omittable. A SQL-expression default (`{ sql }`) can only be
 * evaluated by SQLite, so its constructor default fails with an explanatory issue.
 */
const makeColumnSchema = (
  columnType: FieldColumnType,
  base: Schema.Top,
  def: ColumnDefinitionInput | undefined,
): Schema.Top => {
  const nullable = def?.nullable ?? false
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- a custom `schema` is typed by the helper's signature; `withConstructorDefault` only needs the type-level marker
  const schema = (nullable === true ? Schema.NullOr(base) : base) as Schema.Top & Schema.WithoutConstructorDefault
  const hasDefault = def?.default !== undefined && def.default !== NoDefault
  const withDefault =
    hasDefault === true ? Schema.withConstructorDefault(constructorDefaultFor(def.default))(schema) : schema

  return withDefault.annotate({
    [ColumnType]: columnType,
    ...(def?.primaryKey === true ? { [PrimaryKeyId]: true } : {}),
    ...(def?.autoIncrement === true ? { [AutoIncrement]: true } : {}),
    ...(hasDefault === true ? { [Default]: def.default } : {}),
  })
}

type ColumnFacetsArgs<TDecoded, TNullable extends boolean, TDefault, TPrimaryKey, TAutoIncrement> = {
  default?: TDefault & ColumnDefaultArg<NoInfer<TDecoded>, TNullable>
  nullable?: TNullable
  primaryKey?: TPrimaryKey
  autoIncrement?: TAutoIncrement
}
