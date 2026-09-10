import { shouldNeverHappen } from '@livestore/utils'
import { Schema, SchemaAST, type Types } from '@livestore/utils/effect'

import {
  AutoIncrement,
  type ColumnDefaultMarker,
  ColumnType,
  Default,
  PrimaryKeyId,
  Unique,
} from './column-annotations.ts'
import { getColumnDefForSchema, schemaFieldsToColumns } from './column-def.ts'
import { SqliteDsl } from './db-schema/mod.ts'
import type { QueryBuilder } from './query-builder/mod.ts'
import { makeQueryBuilder, QueryBuilderAstSymbol, QueryBuilderTypeId } from './query-builder/mod.ts'

export const { blob, boolean, column, datetime, datetimeInteger, integer, json, real, text } = SqliteDsl

// Re-export the column definition function
export { getColumnDefForSchema }

export type StateType = 'singleton' | 'dynamic'

export type DefaultSqliteTableDef = SqliteDsl.TableDefinition<string, SqliteDsl.Columns>

// TODO use to hide table def internals
export const TableDefInternalsSymbol = Symbol('TableDefInternals')
export type TableDefInternalsSymbol = typeof TableDefInternalsSymbol

/**
 * A table is an Effect `Schema.Struct` whose fields encode to SQLite values. `rowSchema` is that
 * struct (its `Type` is the decoded row, its `Encoded` the SQLite row) and everything else is derived
 * from it: `sqliteDef` (the DDL view consumed by migrations and the query builder) and `insertSchema`
 * (the row struct with nullable and defaulted fields made optional).
 */
export type TableDefBase<
  TName extends string = string,
  TFields extends Schema.Struct.Fields = FromFields.AnyFields,
  TOptions extends TableOptions = TableOptions,
> = {
  sqliteDef: SqliteDsl.TableDefinition<TName, FromFields.Columns<TFields>>
  options: TOptions
  rowSchema: Schema.Struct<FromFields.SqliteFields<TFields>>
  insertSchema: Schema.Codec<FromFields.InsertRowDecoded<TFields>, FromFields.InsertRowEncoded<TFields>>
}

export type TableDef<
  TName extends string = string,
  TFields extends Schema.Struct.Fields = FromFields.AnyFields,
  TOptions extends TableOptions = TableOptions,
> = TableDefBase<TName, TFields, TOptions> & {
  readonly Type: FromFields.RowDecoded<TFields>
  readonly Encoded: FromFields.RowEncoded<TFields>
} & QueryBuilder<ReadonlyArray<FromFields.RowDecoded<TFields>>, TableDefBase<TName, TFields, TOptions>>

export type TableOptionsInput = Partial<{
  indexes: SqliteDsl.Index[]
}>

export namespace TableDef {
  export type Any = TableDef<any, any, any>
}

export type TableOptions = {
  /** Derived based on whether the table definition has one or more columns (besides the `id` column) */
  readonly isClientDocumentTable: boolean
}

/**
 * Creates a SQLite table definition from an Effect Schema.
 *
 * The table's row schema is a `Schema.Struct` whose fields encode to SQLite values. There are two
 * ways to provide it:
 *
 * 1. `columns`: a map of field schemas, typically built with the `State.SQLite.text()` & co. column
 *    helpers, which return field schemas carrying the SQLite facets (column type, primary key,
 *    default, nullability) as annotations. This is `Schema.Struct(columns)` with a table name.
 * 2. `schema`: any Effect schema. A `Schema.Struct` or `Schema.Class` contributes its `fields`
 *    directly; other schemas (unions of structs, transformations) contribute the property
 *    signatures of their encoded side. Either the `name` property needs to be provided or the
 *    schema needs to have a title/identifier annotation.
 *
 * Fields that do not encode to a SQLite value are stored through a derived codec: booleans as
 * `0 | 1`, a bare `Schema.Date` as ISO text, other values as JSON text (see `getColumnDefForSchema`).
 *
 * ```ts
 * // Using column helpers
 * const usersTable = State.SQLite.table({
 *   name: 'users',
 *   columns: {
 *     id: State.SQLite.text({ primaryKey: true }),
 *     name: State.SQLite.text({ nullable: false }),
 *     email: State.SQLite.text({ nullable: false }),
 *     age: State.SQLite.integer({ nullable: true }),
 *   },
 * })
 * ```
 *
 * ```ts
 * // Using Effect Schema with annotations
 * import { Schema } from '@livestore/utils/effect'
 *
 * const UserSchema = Schema.Struct({
 *   id: Schema.Int.pipe(State.SQLite.withPrimaryKey).pipe(State.SQLite.withAutoIncrement),
 *   email: Schema.String.pipe(State.SQLite.withUnique),
 *   name: Schema.String,
 *   active: Schema.Boolean.pipe(State.SQLite.withDefault(true)),
 *   createdAt: Schema.optional(Schema.Date),
 * })
 *
 * // Option 1: With explicit name
 * const usersTable = State.SQLite.table({
 *   name: 'users',
 *   schema: UserSchema,
 * })
 *
 * // Option 2: With name from schema annotation (title or identifier)
 * const AnnotatedUserSchema = UserSchema.annotate({ title: 'users' })
 * const usersTable2 = State.SQLite.table({
 *   schema: AnnotatedUserSchema,
 * })
 * ```
 *
 * ```ts
 * // Adding indexes
 * const PostSchema = Schema.Struct({
 *   id: Schema.String.pipe(State.SQLite.withPrimaryKey),
 *   title: Schema.String,
 *   authorId: Schema.String,
 *   createdAt: Schema.Date,
 * }).annotate({ identifier: 'posts' })
 *
 * const postsTable = State.SQLite.table({
 *   schema: PostSchema,
 *   indexes: [
 *     { name: 'idx_posts_author', columns: ['authorId'] },
 *     { name: 'idx_posts_created', columns: ['createdAt'], isUnique: false },
 *   ],
 * })
 * ```
 *
 * @remarks
 * - Primary key columns are automatically non-nullable
 * - Columns with `State.SQLite.withUnique` annotation automatically get unique indexes
 * - The `State.SQLite.withAutoIncrement` annotation only works with integer primary keys
 * - Default values can be literal values or SQL expressions
 * - When using Effect Schema without explicit name, the schema must have a title or identifier annotation
 */
// Overload 1: With columns
export function table<
  TName extends string,
  const TColumns extends Schema.Struct.Fields | Schema.Top,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: {
    name: TName
    columns: TColumns
  } & Partial<TOptionsInput>,
): TableDef<TName, ToFields<TColumns>, WithDefaults>

// Overload 2: With schema and explicit name
export function table<
  TName extends string,
  TSchema extends Schema.Top,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: {
    name: TName
    schema: TSchema
  } & Partial<TOptionsInput>,
): TableDef<TName, FieldsOf<TSchema>, WithDefaults>

// Overload 3: With schema and no name (uses schema annotations)
export function table<TSchema extends Schema.Top, const TOptionsInput extends TableOptionsInput = TableOptionsInput>(
  args: {
    schema: TSchema
  } & Partial<TOptionsInput>,
): TableDef<string, FieldsOf<TSchema>, WithDefaults>

// Implementation
export function table(
  args: (
    | {
        name: string
        columns: Schema.Struct.Fields | Schema.Top
      }
    | {
        name: string
        schema: Schema.Top
      }
    | {
        schema: Schema.Top
      }
  ) &
    Partial<TableOptionsInput>,
): TableDef<any, any, any> {
  const { ...options } = args

  let tableName: string
  let propertySignatures: ReadonlyArray<SchemaAST.PropertySignature>

  if ('columns' in args) {
    tableName = args.name
    const fields = Schema.isSchema(args.columns) === true ? { value: args.columns } : args.columns
    propertySignatures = fieldsToPropertySignatures(fields)
  } else if ('schema' in args) {
    propertySignatures = getSqlitePropertySignatures(args.schema)

    // If name is provided, use it; otherwise extract from schema annotations
    if ('name' in args) {
      tableName = args.name
    } else {
      // Use title or identifier, with preference for title
      tableName =
        SchemaAST.resolveTitle(args.schema.ast) ??
        SchemaAST.resolveIdentifier(args.schema.ast) ??
        shouldNeverHappen(
          'When using schema without explicit name, the schema must have a title or identifier annotation',
        )
    }
  } else {
    return shouldNeverHappen('Either `columns` or `schema` must be provided when calling `table()`')
  }

  const { columns, uniqueColumns } = schemaFieldsToColumns(propertySignatures)

  // Create unique indexes for columns with unique annotation
  const uniqueIndexes = uniqueColumns.map((columnName) => ({
    name: `idx_${tableName}_${columnName}_unique`,
    columns: [columnName],
    isUnique: true,
  }))

  const options_: TableOptions = {
    isClientDocumentTable: false,
  }

  // Combine user-provided indexes with unique column indexes
  const allIndexes = [...(options?.indexes ?? []), ...uniqueIndexes]
  const sqliteDef = SqliteDsl.table(tableName, columns, allIndexes)

  const rowSchema = SqliteDsl.structSchemaForTable(sqliteDef)
  const insertSchema = SqliteDsl.insertStructSchemaForTable(sqliteDef)
  const tableDef = {
    sqliteDef,
    options: options_,
    rowSchema,
    insertSchema,
  } satisfies TableDefBase

  const query = makeQueryBuilder(tableDef)
  // tableDef.query = query

  // NOTE we're currently patching the existing tableDef object
  // as it's being used as part of the query builder API
  for (const key of Object.keys(query)) {
    // @ts-expect-error TODO properly implement this
    tableDef[key] = query[key]
  }

  // @ts-expect-error TODO properly type this
  tableDef[QueryBuilderAstSymbol] = query[QueryBuilderAstSymbol]
  // @ts-expect-error TODO properly type this
  tableDef[QueryBuilderTypeId] = query[QueryBuilderTypeId]

  return tableDef as any
}

export type WithDefaults = {
  isClientDocumentTable: false
}

/** A single column schema is shorthand for `{ value: schema }`. */
export type ToFields<TColumns extends Schema.Struct.Fields | Schema.Top> = TColumns extends Schema.Top
  ? { value: TColumns }
  : TColumns extends Schema.Struct.Fields
    ? TColumns
    : never

/**
 * The fields a schema contributes to a table. A `Schema.Struct` or `Schema.Class` contributes its
 * `fields` as-is. Any other schema contributes one codec per key of its encoded side, typed by the
 * decoded side where the key exists there (a union of structs, a struct transformed into a nested
 * type).
 */
export type FieldsOf<TSchema extends Schema.Top> = TSchema extends { readonly fields: infer TFields }
  ? TFields extends Schema.Struct.Fields
    ? TFields
    : never
  : FieldsFromTypes<TSchema['Type'], TSchema['Encoded']>

/**
 * One codec per key of a schema's encoded side, typed by the decoded side where the key exists there.
 * A key whose encoded value admits `null`/`undefined`, or that is optional on the encoded side, is
 * wrapped in `Schema.NullOr` so the structural nullability classification sees it the way the runtime
 * (which marks such property signatures nullable) does.
 */
export type FieldsFromTypes<TType, TEncoded> =
  TEncoded extends Record<string, any>
    ? {
        readonly [K in keyof TEncoded]-?: LooseField<
          TType extends Record<string, any> ? (K extends keyof TType ? TType[K] : TEncoded[K]) : TEncoded[K],
          TEncoded[K],
          K extends OptionalKeys<TEncoded> ? true : false
        >
      }
    : Schema.Struct.Fields

type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T]

type LooseField<T, E, TOptional extends boolean> = TOptional extends true
  ? Schema.NullOr<Schema.Codec<NonNullable<T>, NonNullable<E>>>
  : null extends E
    ? Schema.NullOr<Schema.Codec<NonNullable<T>, NonNullable<E>>>
    : undefined extends E
      ? Schema.NullOr<Schema.Codec<NonNullable<T>, NonNullable<E>>>
      : Schema.Codec<T, E>

export declare namespace FromFields {
  export type SqliteValue = string | number | Uint8Array | null

  /**
   * The field map of a table whose fields are not statically known (`TableDef.Any`, the default
   * `TableDefBase`). Every derived view below collapses to a loose shape for it, so any concrete
   * table definition is assignable to the base.
   */
  export type AnyFields = { readonly [x: string]: Schema.Codec<any, any> }

  /** `true` for `AnyFields`, `any` and other index-signature field maps, `false` for concrete field maps. */
  export type IsLoose<TFields extends Schema.Struct.Fields> = string extends keyof TFields ? true : false

  // --- Classification -------------------------------------------------------------------------
  //
  // Everything below mirrors `getColumnDefForSchema` on the type level by walking the same schema
  // structure the runtime inspects: nullability comes from `null`/`undefined` union members and the
  // optional-key marker, the storage form from the AST class of the field's encoded side, and the
  // default from the LiveStore column-default marker (the runtime reads the matching annotation).

  type Nullish = SchemaAST.Null | SchemaAST.Undefined

  /** Unwraps the wrappers that keep a field's own AST (`optionalKey`, `withConstructorDefault`, `brand`, `mutable`) */
  type Own<F> = F extends { readonly schema: infer S extends Schema.Constraint } ? Own<S> : F

  /** The members of a union field (`Schema.Union`, `NullOr`, `Literals`), also through a transformation's target */
  type MembersOf<F> =
    Own<F> extends { readonly members: infer M extends ReadonlyArray<Schema.Constraint> }
      ? M
      : Own<F> extends { readonly to: infer To extends Schema.Constraint }
        ? MembersOf<To>
        : never

  type IsMemberOf<X, TAst extends SchemaAST.AST> = X extends Schema.Constraint
    ? X['ast'] extends TAst
      ? true
      : HasMember<X, TAst>
    : false

  /** Whether the field's own AST, or any union member of it, is of the given AST class */
  type HasMember<F, TAst extends SchemaAST.AST> =
    Own<F> extends { readonly ast: TAst }
      ? true
      : [MembersOf<F>] extends [never]
        ? false
        : true extends IsMemberOf<MembersOf<F>[number], TAst>
          ? true
          : false

  type IsOptionalKey<F> = F extends { readonly '~type.optionality': 'optional' } ? true : false

  /** Whether the field becomes a nullable column: an optional key or a `null`/`undefined` member. */
  export type IsNullable<F extends Schema.Constraint> = IsOptionalKey<F> extends true ? true : HasMember<F, Nullish>

  export type HasDefault<F extends Schema.Constraint> = F extends { readonly [ColumnDefaultMarker]: true }
    ? true
    : F extends { readonly schema: infer S extends Schema.Constraint }
      ? HasDefault<S>
      : false

  type NonNullish<M extends ReadonlyArray<Schema.Constraint>> = M extends readonly [
    infer H extends Schema.Constraint,
    ...infer R extends ReadonlyArray<Schema.Constraint>,
  ]
    ? H['ast'] extends Nullish
      ? NonNullish<R>
      : readonly [H, ...NonNullish<R>]
    : readonly []

  /** The field without its nullish members: a single remaining member, or a union of the rest */
  type CoreOf<F> = [MembersOf<F>] extends [never]
    ? Own<F>
    : NonNullish<MembersOf<F>> extends readonly [infer Only extends Schema.Constraint]
      ? CoreOf<Only>
      : NonNullish<MembersOf<F>> extends readonly []
        ? Own<F>
        : Schema.Union<NonNullish<MembersOf<F>>>

  /** The AST class of what is stored: a transformation's source, through wrappers */
  type EncodedAstOf<S> = S extends { readonly from: infer From extends Schema.Constraint }
    ? EncodedAstOf<From>
    : S extends { readonly schema: infer Inner extends Schema.Constraint }
      ? EncodedAstOf<Inner>
      : S extends Schema.Constraint
        ? S['ast']
        : never

  type LiteralAst = SchemaAST.Literal | SchemaAST.Union<SchemaAST.Literal>

  /**
   * How a (non-nullish) core schema is stored: as its own codec, as `0 | 1`, as ISO text, or as
   * JSON text. Same order of checks as `getColumnForSchema`.
   */
  type Kind<C extends Schema.Constraint> = SchemaAST.AST extends C['ast']
    ? LooseKind<C>
    : C['ast'] extends SchemaAST.Boolean
      ? 'boolean'
      : [C['Type']] extends [Uint8Array]
        ? 'asIs'
        : EncodedAstOf<C> extends SchemaAST.String | SchemaAST.Number
          ? 'asIs'
          : C['ast'] extends SchemaAST.Declaration
            ? [C['Type']] extends [Date]
              ? 'date'
              : 'json'
            : EncodedAstOf<C> extends LiteralAst
              ? [C['Encoded']] extends [string] | [number] | [bigint]
                ? 'asIs'
                : [C['Encoded']] extends [boolean]
                  ? 'boolean'
                  : 'json'
              : 'json'

  /** A codec without a concrete AST class (a field of a non-struct schema) is classified by its encoded type */
  type LooseKind<C extends Schema.Constraint> = [C['Encoded']] extends [SqliteValue]
    ? 'asIs'
    : [C['Type']] extends [boolean]
      ? 'boolean'
      : [C['Type']] extends [Date]
        ? 'date'
        : 'json'

  /**
   * A field is its own column codec when it is stored as-is and its nullability needs no rewrapping,
   * i.e. it is not an optional key and has no `undefined` member (`Schema.NullOr` is kept as-is).
   */
  type IsOwnColumnCodec<F extends Schema.Constraint> =
    IsOptionalKey<F> extends true
      ? false
      : HasMember<F, SchemaAST.Undefined> extends true
        ? false
        : Kind<CoreOf<F>> extends 'asIs'
          ? true
          : false

  type MaybeNull<T, TNullable extends boolean> = TNullable extends true ? T | null : T

  type Rewrapped<C extends Schema.Constraint, TNullable extends boolean> =
    Kind<C> extends 'asIs'
      ? Schema.Codec<MaybeNull<C['Type'], TNullable>, MaybeNull<C['Encoded'], TNullable>>
      : Kind<C> extends 'boolean'
        ? Schema.Codec<MaybeNull<C['Type'], TNullable>, MaybeNull<0 | 1, TNullable>>
        : Kind<C> extends 'date'
          ? Schema.Codec<MaybeNull<Date, TNullable>, MaybeNull<string, TNullable>>
          : Schema.Codec<MaybeNull<C['Type'], TNullable>, MaybeNull<string, TNullable>>

  /**
   * The codec a field is stored through: the field itself when it can be stored as-is (so its exact
   * schema type is preserved), otherwise the rewrapped codec `getColumnDefForSchema` builds.
   */
  export type SqliteField<F extends Schema.Constraint> = Schema.Top extends F
    ? F
    : IsOwnColumnCodec<F> extends true
      ? F
      : Rewrapped<CoreOf<F>, IsNullable<F>>

  // --- Derived views ---------------------------------------------------------------------------

  export type SqliteFields<TFields extends Schema.Struct.Fields> =
    IsLoose<TFields> extends true ? AnyFields : { readonly [K in keyof TFields]: SqliteField<TFields[K]> }

  export type Columns<TFields extends Schema.Struct.Fields> =
    IsLoose<TFields> extends true
      ? SqliteDsl.Columns
      : {
          readonly [K in keyof TFields]: SqliteDsl.ColumnDefinition<
            SqliteField<TFields[K]>['Encoded'],
            SqliteField<TFields[K]>['Type'],
            IsNullable<TFields[K]>
          >
        }

  export type RowDecodedAll<TFields extends Schema.Struct.Fields> = {
    readonly [K in keyof TFields]: SqliteField<TFields[K]>['Type']
  }

  export type RowEncodedAll<TFields extends Schema.Struct.Fields> = {
    readonly [K in keyof TFields]: SqliteField<TFields[K]>['Encoded']
  }

  export type RowDecoded<TFields extends Schema.Struct.Fields> =
    IsLoose<TFields> extends true ? any : Types.Simplify<RowDecodedAll<TFields>>

  export type RowEncoded<TFields extends Schema.Struct.Fields> =
    IsLoose<TFields> extends true ? any : Types.Simplify<RowEncodedAll<TFields>>

  export type NullableColumnNames<TFields extends Schema.Struct.Fields> = {
    [K in keyof TFields]: IsNullable<TFields[K]> extends true ? K : never
  }[keyof TFields]

  export type DefaultedColumnNames<TFields extends Schema.Struct.Fields> = {
    [K in keyof TFields]: HasDefault<TFields[K]> extends true ? K : never
  }[keyof TFields]

  /** Follows SQL semantics: nullable columns and columns with defaults are omittable on insert. */
  export type OmittableInsertColumnNames<TFields extends Schema.Struct.Fields> =
    | NullableColumnNames<TFields>
    | DefaultedColumnNames<TFields>

  export type RequiredInsertColumnNames<TFields extends Schema.Struct.Fields> = Exclude<
    keyof TFields,
    OmittableInsertColumnNames<TFields>
  >

  /** The columns that must be given on insert, typed by their decoded values */
  export type RequiredInsertRow<TFields extends Schema.Struct.Fields> = {
    readonly [K in RequiredInsertColumnNames<TFields>]: SqliteField<TFields[K]>['Type']
  }

  /** An omittable column may also be passed as `undefined`, which the insert treats as omitted. */
  type Omittable<TRow, TKeys extends keyof TRow> = { readonly [K in TKeys]?: TRow[K] | undefined }

  export type InsertRowDecoded<TFields extends Schema.Struct.Fields> =
    IsLoose<TFields> extends true
      ? any
      : Types.Simplify<
          Pick<RowDecodedAll<TFields>, RequiredInsertColumnNames<TFields>> &
            Omittable<RowDecodedAll<TFields>, OmittableInsertColumnNames<TFields>>
        >

  export type InsertRowEncoded<TFields extends Schema.Struct.Fields> =
    IsLoose<TFields> extends true
      ? any
      : Types.Simplify<
          Pick<RowEncodedAll<TFields>, RequiredInsertColumnNames<TFields>> &
            Omittable<RowEncodedAll<TFields>, OmittableInsertColumnNames<TFields>>
        >
}

/** A struct's fields as property signatures, each carrying the field's own AST (context annotations included). */
const fieldsToPropertySignatures = (fields: Schema.Struct.Fields): ReadonlyArray<SchemaAST.PropertySignature> =>
  Object.entries(fields).map(([name, field]) => new SchemaAST.PropertySignature(name, field.ast))

/**
 * A `Schema.Struct` or `Schema.Class` contributes its fields directly. Any other schema (a union of
 * structs, a transformation that reshapes a flat row into a nested type) contributes one property per
 * key of its encoded side, since the encoded side decides which columns exist. Where the schema itself
 * declares a property of the same name, that property's own AST becomes the column schema: it still
 * carries the field's codec, so e.g. `Schema.DateFromMillis` stores its encoded form and decodes back
 * to its type.
 */
const getSqlitePropertySignatures = (schema: Schema.Top): ReadonlyArray<SchemaAST.PropertySignature> => {
  if ('fields' in schema && typeof schema.fields === 'object' && schema.fields !== null) {
    return fieldsToPropertySignatures(schema.fields as Schema.Struct.Fields)
  }

  const encodedPropertySignatures = getPropertySignatures(SchemaAST.toEncoded(schema.ast))
  const ownPropertySignatures = getPropertySignatures(schema.ast)

  return encodedPropertySignatures.map((encodedPropertySignature) => {
    const ownPropertySignature = ownPropertySignatures.find(
      (propertySignature) => propertySignature.name === encodedPropertySignature.name,
    )

    if (ownPropertySignature === undefined || hasLiveStoreSqliteAnnotation(encodedPropertySignature.type) === true) {
      return encodedPropertySignature
    }

    return ownPropertySignature
  })
}

const getPropertySignatures = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.PropertySignature> => {
  if (SchemaAST.isObjects(ast) === true) return ast.propertySignatures

  if (SchemaAST.isUnion(ast) === true) {
    const members = ast.types.map(getPropertySignatures)
    const [head, ...tail] = members
    if (head === undefined) return []

    return head.flatMap((propertySignature) => {
      const matchingPropertySignatures: Array<SchemaAST.PropertySignature> = []
      for (const propertySignatures of tail) {
        const matchingPropertySignature = propertySignatures.find(
          (memberPropertySignature) => memberPropertySignature.name === propertySignature.name,
        )
        if (matchingPropertySignature === undefined) {
          return []
        }
        matchingPropertySignatures.push(matchingPropertySignature)
      }

      const propertySignatures = [propertySignature, ...matchingPropertySignatures]
      /**
       * `SchemaAST.optionalKey` became internal in Effect rc.109, so the optional-key marker is
       * applied by constructing the union with an optional `Context`. Equivalent here because the
       * union is freshly built and therefore carries no encoding chain to propagate the marker to.
       */
      const hasOptionalMember =
        propertySignatures.some((memberPropertySignature) => SchemaAST.isOptional(memberPropertySignature.type)) ===
        true
      const keyContext = hasOptionalMember === true ? new SchemaAST.Context(true, false) : undefined
      const union = new SchemaAST.Union(
        propertySignatures.map((memberPropertySignature) => memberPropertySignature.type),
        ast.mode,
        undefined,
        undefined,
        undefined,
        keyContext,
      )

      return [new SchemaAST.PropertySignature(propertySignature.name, union)]
    })
  }

  return []
}

/**
 * `annotate` writes onto the last check when a schema has checks, so the annotations are read the way
 * `SchemaAST.resolveAt` does rather than from `ast.annotations` directly.
 */
const hasLiveStoreSqliteAnnotation = (ast: SchemaAST.AST): boolean =>
  columnAnnotationIds.some(
    (id) => SchemaAST.resolveAt(id)(ast) !== undefined || ast.context?.annotations?.[id] !== undefined,
  )

const columnAnnotationIds = [PrimaryKeyId, ColumnType, Default, AutoIncrement, Unique]
