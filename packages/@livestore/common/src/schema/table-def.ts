import { notYetImplemented, type Nullable, shouldNeverHappen } from '@livestore/utils'
import type { Option, Types } from '@livestore/utils/effect'
import { Schema, SchemaAST } from '@livestore/utils/effect'

import { SessionIdSymbol } from '../adapter-types.js'
import type { DerivedMutationHelperFns } from '../derived-mutations.js'
import type { QueryBuilder, QueryBuilderAst, RowQuery } from '../query-builder/mod.js'
import { makeQueryBuilder, QueryBuilderAstSymbol, QueryBuilderTypeId } from '../query-builder/mod.js'
import type { QueryInfo } from '../query-info.js'
import { sql } from '../util.js'
import { SqliteDsl } from './db-schema/mod.js'
import type * as LiveStoreEvent from './LiveStoreEvent.js'
import type { Materializer, MutationDef } from './mutations.js'
import { defineEvent, defineMaterializer } from './mutations.js'

export const { blob, boolean, column, datetime, integer, isColumnDefinition, json, real, text } = SqliteDsl

export type StateType = 'singleton' | 'dynamic'

export type DefaultSqliteTableDef = SqliteDsl.TableDefinition<string, SqliteDsl.Columns>
export type DefaultSqliteTableDefConstrained = SqliteDsl.TableDefinition<string, SqliteDsl.ConstraintColumns>

// TODO use to hide table def internals
export const TableDefInternalsSymbol = Symbol('TableDefInternals')
export type TableDefInternalsSymbol = typeof TableDefInternalsSymbol

export type TableDefBase<
  TSqliteDef extends DefaultSqliteTableDef = DefaultSqliteTableDefConstrained,
  TOptions extends TableOptions = TableOptions,
> = {
  sqliteDef: TSqliteDef
  options: TOptions
  // Derived from `sqliteDef`, so only exposed for convenience
  rowSchema: SqliteDsl.StructSchemaForColumns<TSqliteDef['columns']>
  insertSchema: SqliteDsl.InsertStructSchemaForColumns<TSqliteDef['columns']>
}

export type TableDef<
  TSqliteDef extends DefaultSqliteTableDef = DefaultSqliteTableDefConstrained,
  TOptions extends TableOptions = TableOptions,
  // NOTE we're not using `SqliteDsl.StructSchemaForColumns<TSqliteDef['columns']>`
  // as we don't want the alias type for users to show up, so we're redefining it here
  TSchema = Schema.Schema<
    SqliteDsl.AnyIfConstained<
      TSqliteDef['columns'],
      { readonly [K in keyof TSqliteDef['columns']]: TSqliteDef['columns'][K]['schema']['Type'] }
    >,
    SqliteDsl.AnyIfConstained<
      TSqliteDef['columns'],
      { readonly [K in keyof TSqliteDef['columns']]: TSqliteDef['columns'][K]['schema']['Encoded'] }
    >
  >,
> = {
  sqliteDef: TSqliteDef
  options: TOptions
  // Derived from `sqliteDef`, so only exposed for convenience
  rowSchema: TSchema
  insertSchema: SqliteDsl.InsertStructSchemaForColumns<TSqliteDef['columns']>
  // query: QueryBuilder<ReadonlyArray<Schema.Schema.Type<TSchema>>, TableDefBase<TSqliteDef & {}, TOptions>>
  readonly Type: Schema.Schema.Type<TSchema>
  readonly Encoded: Schema.Schema.Encoded<TSchema>
} & QueryBuilder<ReadonlyArray<Schema.Schema.Type<TSchema>>, TableDefBase<TSqliteDef & {}, TOptions>>
// (TOptions['deriveEvents']['enabled'] extends true
//   ? DerivedMutationHelperFns<TSqliteDef['columns'], TSqliteDef['name']>
//   : {})
// DerivedMutationHelperFns<TSqliteDef['columns'], TOptions, TSqliteDef['name']>

export type TableOptionsInput = Partial<{
  indexes: SqliteDsl.Index[]
  disableAutomaticIdColumn: boolean
  // deriveEvents: boolean
  // | {
  //     clientOnly?: boolean
  //     // defaultId?: SessionIdSymbol | string | undefined
  //   }
}>

type ToColumns<TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>> =
  TColumns extends SqliteDsl.Columns
    ? TColumns
    : TColumns extends SqliteDsl.ColumnDefinition<any, any>
      ? { value: TColumns }
      : never

// TODO double check if this is still needed?
type ValidateTableOptionsInput<
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  TOptionsInput extends TableOptionsInput,
  TPassthroughIfValid,
> =
  SqliteDsl.FromColumns.RequiresInsertValues<ToColumns<TColumns>> extends true
    ? TPassthroughIfValid
    : TPassthroughIfValid

export type TableOptions = {
  // TODO remove
  readonly disableAutomaticIdColumn: boolean

  // TODO remove
  /**
   * Setting this to true will automatically derive insert, update and delete mutations for this table. Example:
   *
   * ```ts
   * const todos = table({ name: 'todos', columns: { ... }, { deriveEvents: true })
   * todos.insert({ id: '1', text: 'Hello' })
   * ```
   *
   * This is also a prerequisite for using the `useClientDocument`, `useClientDocument` and `rowQuery` APIs.
   *
   * Important: When using this option, make sure you're following the "Rules of mutations" for the table schema.
   */
  // readonly deriveEvents:
  //   | { enabled: false }
  //   | {
  //       enabled: true
  //       /**
  //        * When set to true, the mutations won't be synced over the network
  //        */
  //       // clientOnly: boolean
  //       // defaultId: SessionIdSymbol | string | undefined
  //       // // TODO proper generic types
  //       // derivedEvents: DerivedMutationHelperFns.DerivedEvents<any, any, any>
  //       // // TODO proper generic types
  //       // derivedMaterializers: DerivedMutationHelperFns.DerivedMaterializers<any, any>
  //     }

  /** Derived based on whether the table definition has one or more columns (besides the `id` column) */
  readonly isClientDocumentTable: boolean

  /**
   * Derived based on whether the table definition has one or more columns (besides the `id` column) that require
   * insert values (i.e. are not nullable and don't have a default value)
   *
   * `isSingleton` tables always imply `requiresInsertValues: false`
   */
  readonly requiredInsertColumnNames: string
}

export const table = <
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: {
    name: TName
    columns: TColumns
  } & Partial<TOptionsInput>,
): TableDef<
  SqliteTableDefForInput<TName, TColumns, WithDefaults<TOptionsInput, TColumns>>,
  WithDefaults<TOptionsInput, TColumns>
> => {
  const { name, columns: columnOrColumns, ...options } = args
  const tablePath = name

  const options_: TableOptions = {
    disableAutomaticIdColumn: options?.disableAutomaticIdColumn ?? false,
    // deriveEvents: {
    //   enabled: false,
    // },
    // deriveEvents:
    //   options?.deriveEvents === true
    //     ? { enabled: true as const }
    //     : options?.deriveEvents === false
    //       ? { enabled: false as const }
    //       : options?.deriveEvents === undefined
    //         ? { enabled: false as const }
    //         : {
    //             enabled: true as const,
    //             // clientOnly: options.deriveEvents.clientOnly ?? false,
    //             // defaultId: options.deriveEvents.defaultId ?? undefined,
    //             // derivedMutationDefs: undefined,
    //           },
    isClientDocumentTable: SqliteDsl.isColumnDefinition(columnOrColumns) === true,
    requiredInsertColumnNames: 'type-level-only',
  }

  const columns = (
    SqliteDsl.isColumnDefinition(columnOrColumns) ? { value: columnOrColumns } : columnOrColumns
  ) as SqliteDsl.Columns

  // if (options_.disableAutomaticIdColumn === true) {
  //   if (columns.id === undefined && options_.isSingleton === true) {
  //     shouldNeverHappen(
  //       `Cannot create table ${name} with "isSingleton: true" because there is no column with name "id" and "disableAutomaticIdColumn: true" is set`,
  //     )
  //   }
  // } else if (columns.id === undefined && ReadonlyRecord.some(columns, (_) => _.primaryKey === true) === false) {
  //   if (options_.isSingleton) {
  //     columns.id = SqliteDsl.text({ schema: Schema.Literal('singleton'), primaryKey: true, default: 'singleton' })
  //   } else {
  //     columns.id = SqliteDsl.text({ primaryKey: true })
  //   }
  // }

  const sqliteDef = SqliteDsl.table(tablePath, columns, options?.indexes ?? [])

  // TODO also enforce this on the type level
  // if (options_.isSingleton) {
  //   for (const column of sqliteDef.ast.columns) {
  //     if (column.nullable === false && column.default._tag === 'None') {
  //       shouldNeverHappen(
  //         `When creating a singleton table, each column must be either nullable or have a default value. Column '${column.name}' is neither.`,
  //       )
  //     }
  //   }
  // }

  // const isClientDocumentTable = SqliteDsl.isColumnDefinition(columnOrColumns) === true

  const rowSchema = SqliteDsl.structSchemaForTable(sqliteDef)
  const insertSchema = SqliteDsl.insertStructSchemaForTable(sqliteDef)
  const tableDef = {
    sqliteDef,
    options: options_,
    rowSchema,
    insertSchema,
  } satisfies TableDefBase

  const query = makeQueryBuilder(tableDef)
  // const tableDef = { ...tableDefBase, query } satisfies TableDef

  // NOTE we're currently patching the existing tableDef object
  // as it's being used as part of the query builder API
  for (const key of Object.keys(query)) {
    // @ts-expect-error TODO properly implement this
    tableDef[key] = query[key]
  }

  // @ts-expect-error TODO properly implement this
  tableDef[QueryBuilderAstSymbol] = query[QueryBuilderAstSymbol]

  // tableDef.query = query

  return tableDef as any
}

export type ClientDocumentTableOptions<TType> = {
  partialSet: boolean
  default: {
    id: SessionIdSymbol | string | undefined
    value: TType
  }
}

export namespace ClientDocumentTableOptions {
  export type Input<TType> = {
    /**
     * Whether to allow for partial set operations. Only applies if the schema is a struct.
     *
     * @default true
     */
    partialSet?: boolean
    default: {
      id?: SessionIdSymbol | string | undefined
      value: TType
    }
  }

  export type WithDefaults<TInput extends Input<any>> = {
    partialSet: TInput['partialSet'] extends false ? false : true
    default: {
      id: TInput['default']['id'] extends string | SessionIdSymbol ? TInput['default']['id'] : undefined
      value: TInput['default']['value']
    }
  }
}

export type ClientDocumentTableDef<
  TName extends string,
  TType,
  TEncoded,
  TOptions extends ClientDocumentTableOptions<TType>,
> = TableDef<
  ClientDocumentTableDef.SqliteDef<TName, TType, TEncoded>,
  {
    disableAutomaticIdColumn: true
    isClientDocumentTable: true
    requiredInsertColumnNames: never
  }
> &
  ClientDocumentTableDef.Trait<TName, TType, TEncoded, TOptions>

export namespace ClientDocumentTableDef {
  export type Any = ClientDocumentTableDef<any, any, any, any>

  export type SqliteDef<TName extends string, TType, TEncoded> = SqliteDsl.TableDefinition<
    TName,
    {
      id: SqliteDsl.ColumnDefinition<string, string> & { default: Option.Some<string> }
      value: SqliteDsl.ColumnDefinition<TEncoded, TType> & { default: Option.Some<TType> }
    }
  >

  export type TableDefBase_<TName extends string, TType, TEncoded> = TableDefBase<
    SqliteDef<TName, TType, TEncoded>,
    {
      disableAutomaticIdColumn: false
      isClientDocumentTable: true
      requiredInsertColumnNames: never
    }
  >

  export type Trait<TName extends string, TType, TEncoded, TOptions extends ClientDocumentTableOptions<TType>> = {
    // get: QueryBuilder<TType, ClientDocumentTableDef<TName, TType, TEncoded, TOptions>>['getOrCreate']
    readonly get: MakeGetQueryBuilder2<ClientDocumentTableDef.Trait<TName, TType, TEncoded, TOptions>>
    // readonly get: MakeGetQueryBuilder<ClientDocumentTableDef.Trait<TName, TType, TEncoded, TOptions>>
    readonly set: (TOptions['default']['id'] extends undefined
      ? (
          args: TOptions['partialSet'] extends false ? TType : Partial<TType>,
          id: string | SessionIdSymbol,
        ) => LiveStoreEvent.PartialAnyDecoded
      : (
          args: TOptions['partialSet'] extends false ? TType : Partial<TType>,
          id?: string | SessionIdSymbol,
        ) => LiveStoreEvent.PartialAnyDecoded) & {
      readonly name: `${TName}Set`
      readonly schema: Schema.Schema<any>
      readonly Event: {
        readonly mutation: `${TName}Set`
        readonly args: any
      }
      readonly options: { derived: true; clientOnly: true; facts: undefined }
    }
    readonly Value: TType
    readonly [ClientDocumentTableDefSymbol]: {
      readonly documentSchema: Schema.Schema<TType, TEncoded>
      readonly options: TOptions
      readonly Type: TType
      readonly Encoded: TEncoded
      readonly derived: {
        readonly setEventDef: MutationDef.Any
        readonly setMaterializer: Materializer<MutationDef.Any>
      }
    }
  }

  export type GetOptions<TTableDef extends TraitAny> =
    TTableDef extends ClientDocumentTableDef.Trait<any, any, any, infer TOptions> ? TOptions : never

  export type TraitAny = Trait<any, any, any, any>

  export type IdType<TTableDef extends TraitAny> =
    TTableDef extends ClientDocumentTableDef.Trait<any, any, any, infer TOptions>
      ? TOptions['default']['id'] extends SessionIdSymbol | string
        ? TOptions['default']['id']
        : never
      : never
}

export const ClientDocumentTableDefSymbol = Symbol('ClientDocumentTableDef')
export type ClientDocumentTableDefSymbol = typeof ClientDocumentTableDefSymbol

export const clientDocument = <
  TName extends string,
  TType,
  TEncoded,
  const TOptions extends ClientDocumentTableOptions.Input<TType>,
>({
  name,
  schema: documentSchema,
  ...inputOptions
}: {
  name: TName
  schema: Schema.Schema<TType, TEncoded>
} & TOptions): ClientDocumentTableDef<
  TName,
  TType,
  TEncoded,
  Types.Simplify<ClientDocumentTableOptions.WithDefaults<TOptions>>
> => {
  const options = {
    partialSet: inputOptions.partialSet ?? true,
    default: {
      id: inputOptions.default.id,
      value: inputOptions.default.value,
    },
  } satisfies ClientDocumentTableOptions<TType>

  const columns = {
    id: SqliteDsl.text({ primaryKey: true }),
    value: SqliteDsl.json({ schema: documentSchema }),
  }

  const tableDef = table({ name, columns })

  // @ts-expect-error TODO properly type this
  tableDef.options.isClientDocumentTable = true

  const derivedSetEventDef = defineEvent({
    name: `${name}Set`,
    schema: Schema.Struct({
      id: Schema.Union(Schema.String, Schema.UniqueSymbolFromSelf(SessionIdSymbol)),
      value: options.partialSet ? Schema.partial(documentSchema) : documentSchema,
    }).annotations({ title: `${name}Set:Args` }),
    clientOnly: true,
    derived: true,
  })

  const derivedSetMaterializer = defineMaterializer(derivedSetEventDef, ({ id, value }) => {
    if (id === SessionIdSymbol) {
      return shouldNeverHappen(`SessionIdSymbol needs to be replaced before materializing the set event`)
    }

    const valueColJsonSchema = Schema.parseJson(Schema.partial(documentSchema))

    const encodedDefaultValueRes = Schema.encodeEither(valueColJsonSchema)(
      mergeDefaultValues(options.default.value, value),
    )
    const encodedPatchValueRes = Schema.encodeEither(valueColJsonSchema)(value)

    if (encodedDefaultValueRes._tag === 'Left') {
      return shouldNeverHappen(`Failed to encode value for ${tableDef.sqliteDef.name}:`, encodedDefaultValueRes.left)
    }

    if (encodedPatchValueRes._tag === 'Left') {
      return shouldNeverHappen(`Failed to encode value for ${tableDef.sqliteDef.name}:`, encodedPatchValueRes.left)
    }

    const encodedDefaultValue = encodedDefaultValueRes.right
    const encodedPatchValue = encodedPatchValueRes.right
    const sqlQuery = `
      INSERT INTO '${tableDef.sqliteDef.name}' (id, value)
      VALUES (?, ?)
      ON CONFLICT (id) DO UPDATE SET
        value = json_patch(value, ?)
    `

    const bindValues = [id, encodedDefaultValue, encodedPatchValue]

    return { sql: sqlQuery, bindValues, writeTables: new Set([tableDef.sqliteDef.name]) }
  })

  const setEventDef = (...args: any[]) => {
    const [value, id = options.default.id] = args
    return derivedSetEventDef({ id, value })
  }

  Object.defineProperty(setEventDef, 'name', { value: `${name}Set` })
  Object.defineProperty(setEventDef, 'schema', {
    value: Schema.Struct({
      id: Schema.String,
      value: options.partialSet ? Schema.partial(documentSchema) : documentSchema,
    }),
  })
  Object.defineProperty(setEventDef, 'options', { value: { derived: true, clientOnly: true, facts: undefined } })

  const clientDocumentTableDefTrait: ClientDocumentTableDef.Trait<
    TName,
    TType,
    TEncoded,
    ClientDocumentTableOptions<TType>
  > = {
    get: makeGetQueryBuilder(() => clientDocumentTableDef) as any,
    set: setEventDef as any,
    Value: 'only-for-type-inference' as any,
    [ClientDocumentTableDefSymbol]: {
      derived: {
        setEventDef: derivedSetEventDef,
        setMaterializer: derivedSetMaterializer,
      },
      documentSchema,
      options,
      Type: 'only-for-type-inference' as any,
      Encoded: 'only-for-type-inference' as any,
    },
  }

  const clientDocumentTableDef = {
    ...tableDef,
    ...clientDocumentTableDefTrait,
  } as any

  return clientDocumentTableDef
}

const mergeDefaultValues = <T>(schemaDefaultValues: T, explicitDefaultValues: T): T => {
  if (
    typeof schemaDefaultValues !== 'object' ||
    typeof explicitDefaultValues !== 'object' ||
    schemaDefaultValues === null ||
    explicitDefaultValues === null
  ) {
    return explicitDefaultValues
  }

  return Object.keys(schemaDefaultValues as any).reduce((acc, key) => {
    acc[key] = (explicitDefaultValues as any)[key] ?? (schemaDefaultValues as any)[key]
    return acc
  }, {} as any)
}

// TODO refactor / remove
export const tableHasDerivedMutations = <TTableDef extends TableDefBase>(
  tableDef: TTableDef,
): tableDef is TTableDef & {
  options: { deriveEvents: { enabled: true; clientOnly: boolean; defaultId: any } }
} & DerivedMutationHelperFns<TTableDef['sqliteDef']['columns'], TTableDef['sqliteDef']['name']> =>
  tableDef.options.isClientDocumentTable === true

export const tableIsClientDocumentTable = <TTableDef extends TableDefBase>(
  tableDef: TTableDef,
): tableDef is TTableDef & {
  options: { isClientDocumentTable: true }
} & ClientDocumentTableDef.Trait<TTableDef['sqliteDef']['name'], any, any, any> =>
  tableDef.options.isClientDocumentTable === true

export type PrettifyFlat<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

type SqliteTableDefForInput<
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  TOptions extends TableOptions,
> = SqliteDsl.TableDefinition<TName, PrettifyFlat<WithId<ToColumns<TColumns>, TOptions>>>

// TODO remove
type WithId<TColumns extends SqliteDsl.Columns, TOptions extends TableOptions> = TColumns &
  ('id' extends keyof TColumns
    ? {}
    : TOptions['disableAutomaticIdColumn'] extends true
      ? {}
      : {
          id: SqliteDsl.ColumnDefinition<string, string>
        })

type WithDefaults<
  TOptionsInput extends TableOptionsInput,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
> = {
  disableAutomaticIdColumn: TOptionsInput['disableAutomaticIdColumn'] extends true ? true : false
  isClientDocumentTable: false
  requiredInsertColumnNames: SqliteDsl.FromColumns.RequiredInsertColumnNames<ToColumns<TColumns>>
}

// type MakeGetQueryBuilder2<TTableDef extends ClientDocumentTableDef.TraitAny> = {
//   <
//     TTableDef extends ClientDocumentTableDef<
//       any,
//       any,
//       any,
//       ClientDocumentTableOptions<any> & { default: { id: string | SessionIdSymbol } }
//     >,
//   >(
//     id?: ClientDocumentTableDef.IdType<TTableDef> | SessionIdSymbol,
//     options?: { default: Partial<TTableDef['Value']> },
//   ): QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
//   <TTableDef extends ClientDocumentTableDef<any, any, any, any>>(
//     id: ClientDocumentTableDef.IdType<TTableDef> | SessionIdSymbol,
//     options?: { default: Partial<TTableDef['Value']> },
//   ): QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
// }

type MakeGetQueryBuilder2<TTableDef extends ClientDocumentTableDef.TraitAny> =
  TTableDef extends ClientDocumentTableDef.Trait<infer TName, infer TType, infer TEncoded, infer TOptions>
    ? TOptions extends ClientDocumentTableOptions<TType> & { default: { id: string | SessionIdSymbol } }
      ? (
          id?: ClientDocumentTableDef.IdType<TTableDef> | SessionIdSymbol,
          options?: { default: Partial<TType> },
        ) => QueryBuilder<
          TType,
          ClientDocumentTableDef.TableDefBase_<TName, TType, TEncoded>,
          QueryBuilder.ApiFeature,
          QueryInfo.Row
        >
      : (
          id: ClientDocumentTableDef.IdType<TTableDef> | SessionIdSymbol,
          options?: { default: Partial<TType> },
        ) => QueryBuilder<
          TType,
          ClientDocumentTableDef.TableDefBase_<TName, TType, TEncoded>,
          QueryBuilder.ApiFeature,
          QueryInfo.Row
        >
    : never

type MakeGetQueryBuilder_ = <TTableDef extends ClientDocumentTableDef.TraitAny>(
  getTableDef: () => TTableDef,
) => {
  <
    TTableDef extends ClientDocumentTableDef<
      any,
      any,
      any,
      ClientDocumentTableOptions<any> & { default: { id: string | SessionIdSymbol } }
    >,
  >(
    id?: ClientDocumentTableDef.IdType<TTableDef> | SessionIdSymbol,
    options?: { default: Partial<TTableDef['Value']> },
  ): QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
  <TTableDef extends ClientDocumentTableDef<any, any, any, any>>(
    id: ClientDocumentTableDef.IdType<TTableDef> | SessionIdSymbol,
    options?: { default: Partial<TTableDef['Value']> },
  ): QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
}

type MakeGetQueryBuilder<TTableDef extends ClientDocumentTableDef.TraitAny> =
  TTableDef extends ClientDocumentTableDef.Trait<infer TName, infer TType, infer TEncoded, infer TOptions>
    ? TOptions extends ClientDocumentTableOptions<TType> & { default: { id: string | SessionIdSymbol } }
      ? <
          TTableDef extends ClientDocumentTableDef<
            TName,
            TType,
            TEncoded,
            ClientDocumentTableOptions<TType> & { default: { id: string | SessionIdSymbol } }
          >,
        >(
          id?: string | SessionIdSymbol,
          options?: { default: Partial<TType> },
        ) => QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
      : <
          TTableDef extends ClientDocumentTableDef<
            TName,
            TType,
            TEncoded,
            ClientDocumentTableOptions<TType> & { default: { id: string | SessionIdSymbol | undefined } }
          >,
        >(
          id: string | SessionIdSymbol,
          options?: { default: Partial<TType> },
        ) => QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
    : never
// <TTableDef extends ClientDocumentTableDef<any, any, any, any>>(
//   id: string,
//   insertValues: any,
// ): QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>

const makeGetQueryBuilder = <TTableDef extends ClientDocumentTableDef<any, any, any, any>>(
  getTableDef: () => TTableDef,
): MakeGetQueryBuilder2<TTableDef> => {
  // const makeGetQueryBuilder: MakeGetQueryBuilder_ = (getTableDef) => {
  return ((...args: any[]) => {
    const tableDef = getTableDef()

    const [id = tableDef[ClientDocumentTableDefSymbol].options.default.id, options = {}] = args

    const explicitDefaultValues = options.default ?? tableDef[ClientDocumentTableDefSymbol].options.default.value

    const ast: QueryBuilderAst.RowQuery = {
      _tag: 'RowQuery',
      tableDef,
      id,
      explicitDefaultValues,
    }

    return {
      [QueryBuilderTypeId]: QueryBuilderTypeId,
      [QueryBuilderAstSymbol]: ast,
      ResultType: 'only-for-type-inference' as any,
      asSql: () => {
        return {
          query: `SELECT * FROM '${tableDef.sqliteDef.name}' WHERE id = ?`,
          bindValues: [id],
        }
      },
      toString: () => '',
      ...({} as any), // Needed for type cast
    }
  }) as any
}

/**
 * Special:
 * - Synced across client sessions (e.g. tabs) but not across different clients
 * - Derived setters
 *   - Emits client-only events
 *   - Has implicit setter-reducers
 * - Similar to `React.useState` (except it's persisted)
 *
 * Careful:
 * - When changing the table definitions in a non-backwards compatible way, the state might be lost without
 *   explicit reducers to handle the old auto-generated events
 */
// export const atom = <
//   TName extends string,
//   TData extends Schema.Struct.Fields,
//   // TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
//   TOptionsInput extends TableOptionsInput = TableOptionsInput,
// >(
//   args: {
//     name: TName
//     defaultId?: SessionIdSymbol | string
//     data: TData
//   } & Partial<TOptionsInput>,
// ): // AtomTableDef<
// //   ValidateTableOptionsInput<
// //     TColumns,
// //     TOptionsInput,
// //     TableDef<
// //       SqliteTableDefForInput<TName, TColumns, WithDefaults<TOptionsInput, TColumns>>,
// //       WithDefaults<TOptionsInput, TColumns>
// //     >
// //   >
// // > => {
// {
//   table: ValidateTableOptionsInput<
//     TColumns,
//     TOptionsInput,
//     TableDef<
//       SqliteTableDefForInput<TName, TColumns, WithDefaults<TOptionsInput, TColumns>>,
//       WithDefaults<TOptionsInput, TColumns>
//     >
//   >
//   set: (args: any) => LiveStoreEvent.PartialAnyDecoded
//   get: QueryBuilder<
//     Types.Simplify<Schema.Struct.Type<TData>>,
//     TableDef<
//       SqliteTableDefForInput<TName, TColumns, WithDefaults<TOptionsInput, TColumns>>,
//       WithDefaults<TOptionsInput, TColumns>
//     >
//   >
// } => {
//   const schema = Schema.Struct(args.data)
//   const tableDef = {
//     sqliteDef,
//     options: {},
//     schema,
//     insertSchema,
//   } satisfies TableDefBase

//   return {
//     table: tableDef,
//     set: () => {},
//     get: () => {},
//   }
// }

export type AtomTableDef<TSqliteDef extends DefaultSqliteTableDef = DefaultSqliteTableDefConstrained> = {
  table: TableDef<TSqliteDef, TableOptions>
  set: (args: any) => MutationDef.Any
  get: QueryBuilder<SqliteDsl.FromColumns.RowDecoded<TSqliteDef['columns']>, TableDef<TSqliteDef, TableOptions>>
}

export namespace FromTable {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TTableDef extends TableDefBase> = Types.Simplify<
    Nullable<Pick<RowDecodedAll<TTableDef>, NullableColumnNames<TTableDef>>> &
      Omit<RowDecodedAll<TTableDef>, NullableColumnNames<TTableDef>>
  >

  export type NullableColumnNames<TTableDef extends TableDefBase> = FromColumns.NullableColumnNames<
    TTableDef['sqliteDef']['columns']
  >

  export type Columns<TTableDef extends TableDefBase> = {
    [K in keyof TTableDef['sqliteDef']['columns']]: TTableDef['sqliteDef']['columns'][K]['columnType']
  }

  export type RowEncodeNonNullable<TTableDef extends TableDefBase> = {
    [K in keyof TTableDef['sqliteDef']['columns']]: Schema.Schema.Encoded<
      TTableDef['sqliteDef']['columns'][K]['schema']
    >
  }

  export type RowEncoded<TTableDef extends TableDefBase> = Types.Simplify<
    Nullable<Pick<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>> &
      Omit<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>
  >

  export type RowDecodedAll<TTableDef extends TableDefBase> = {
    [K in keyof TTableDef['sqliteDef']['columns']]: Schema.Schema.Type<TTableDef['sqliteDef']['columns'][K]['schema']>
  }
}

export namespace FromColumns {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TColumns extends SqliteDsl.Columns> = Types.Simplify<
    Nullable<Pick<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowDecodedAll<TColumns extends SqliteDsl.Columns> = {
    [K in keyof TColumns]: Schema.Schema.Type<TColumns[K]['schema']>
  }

  export type RowEncoded<TColumns extends SqliteDsl.Columns> = Types.Simplify<
    Nullable<Pick<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowEncodeNonNullable<TColumns extends SqliteDsl.Columns> = {
    [K in keyof TColumns]: Schema.Schema.Encoded<TColumns[K]['schema']>
  }

  export type NullableColumnNames<TColumns extends SqliteDsl.Columns> = keyof {
    [K in keyof TColumns as TColumns[K]['default'] extends true ? K : never]: {}
  }

  export type RequiredInsertColumnNames<TColumns extends SqliteDsl.Columns> =
    SqliteDsl.FromColumns.RequiredInsertColumnNames<TColumns>

  export type InsertRowDecoded<TColumns extends SqliteDsl.Columns> = SqliteDsl.FromColumns.InsertRowDecoded<TColumns>
}
