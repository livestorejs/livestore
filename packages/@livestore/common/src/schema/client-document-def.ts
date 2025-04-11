import { shouldNeverHappen } from '@livestore/utils'
import type { Option, Types } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import { SessionIdSymbol } from '../adapter-types.js'
import type { QueryBuilder, QueryBuilderAst } from '../query-builder/mod.js'
import { QueryBuilderAstSymbol, QueryBuilderTypeId } from '../query-builder/mod.js'
import type { QueryInfo } from '../query-info.js'
import { SqliteDsl } from './db-schema/mod.js'
import type { EventDef, Materializer } from './EventDef.js'
import { defineEvent, defineMaterializer } from './EventDef.js'
import type * as LiveStoreEvent from './LiveStoreEvent.js'
import type { TableDef, TableDefBase } from './table-def.js'
import { table } from './table-def.js'

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

export const tableIsClientDocumentTable = <TTableDef extends TableDefBase>(
  tableDef: TTableDef,
): tableDef is TTableDef & {
  options: { isClientDocumentTable: true }
} & ClientDocumentTableDef.Trait<TTableDef['sqliteDef']['name'], any, any, any> =>
  tableDef.options.isClientDocumentTable === true

type MakeGetQueryBuilder<TTableDef extends ClientDocumentTableDef.TraitAny> =
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

const makeGetQueryBuilder = <TTableDef extends ClientDocumentTableDef<any, any, any, any>>(
  getTableDef: () => TTableDef,
): MakeGetQueryBuilder<TTableDef> => {
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
    isClientDocumentTable: true
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
      isClientDocumentTable: true
    }
  >

  export type Trait<TName extends string, TType, TEncoded, TOptions extends ClientDocumentTableOptions<TType>> = {
    // get: QueryBuilder<TType, ClientDocumentTableDef<TName, TType, TEncoded, TOptions>>['getOrCreate']
    readonly get: MakeGetQueryBuilder<ClientDocumentTableDef.Trait<TName, TType, TEncoded, TOptions>>
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
        readonly name: `${TName}Set`
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
        readonly setEventDef: EventDef.Any
        readonly setMaterializer: Materializer<EventDef.Any>
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
