import { shouldNeverHappen } from '@livestore/utils'
import type { Option, Types } from '@livestore/utils/effect'
import { Schema, SchemaAST } from '@livestore/utils/effect'

import { SessionIdSymbol } from '../../../adapter-types.ts'
import { sql } from '../../../util.ts'
import type { EventDef, Materializer } from '../../EventDef.ts'
import { defineEvent, defineMaterializer } from '../../EventDef.ts'
import { SqliteDsl } from './db-schema/mod.ts'
import type { QueryBuilder, QueryBuilderAst } from './query-builder/mod.ts'
import { QueryBuilderAstSymbol, QueryBuilderTypeId } from './query-builder/mod.ts'
import type { TableDef, TableDefBase } from './table-def.ts'
import { table } from './table-def.ts'

/**
 * Special:
 * - Synced across client sessions (e.g. tabs) but not across different clients
 * - Derived setters
 *   - Emits client-only events
 *   - Has implicit setter-materializers
 * - Similar to `React.useState` (except it's persisted)
 *
 * Careful:
 * - When changing the table definitions in a non-backwards compatible way, the state might be lost without
 *   explicit materializers to handle the old auto-generated events
 *
 * Usage:
 *
 * ```ts
 * // Querying data
 * // `'some-id'` can be ommited for SessionIdSymbol
 * store.queryDb(clientDocumentTable.get('some-id'))
 *
 * // Setting data
 * // Again, `'some-id'` can be ommited for SessionIdSymbol
 * store.commit(clientDocumentTable.set({ someField: 'some-value' }, 'some-id'))
 * ```
 */
export const clientDocument = <
  TName extends string,
  TType,
  TEncoded,
  const TOptions extends ClientDocumentTableOptions.Input<NoInfer<TType>>,
>({
  name,
  schema: valueSchema,
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

  // Column needs optimistic schema to read historical data formats
  const optimisticColumnSchema = createOptimisticEventSchema({
    valueSchema,
    defaultValue: options.default.value,
    partialSet: false, // Column always stores full documents
  })

  const columns = {
    id: SqliteDsl.text({ primaryKey: true }),
    value: SqliteDsl.json({ schema: optimisticColumnSchema }),
  }

  const tableDef = table({ name, columns })

  // @ts-expect-error TODO properly type this
  tableDef.options.isClientDocumentTable = true

  const { eventDef: derivedSetEventDef, materializer: derivedSetMaterializer } = deriveEventAndMaterializer({
    name,
    valueSchema,
    defaultValue: options.default.value,
    partialSet: options.partialSet,
  })

  const setEventDef = (...args: any[]) => {
    const [value, id = options.default.id] = args
    return derivedSetEventDef({ id, value })
  }

  Object.defineProperty(setEventDef, 'name', { value: `${name}Set` })
  Object.defineProperty(setEventDef, 'schema', {
    value: Schema.Struct({
      id: Schema.String,
      value: options.partialSet ? Schema.partial(valueSchema) : valueSchema,
    }).annotations({ title: `${name}Set:Args` }),
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
    default: options.default,
    valueSchema,
    [ClientDocumentTableDefSymbol]: {
      derived: {
        setEventDef: derivedSetEventDef as any,
        setMaterializer: derivedSetMaterializer as any,
      },
      options,
    },
  }

  const clientDocumentTableDef = {
    ...tableDef,
    ...clientDocumentTableDefTrait,
  } as any

  return clientDocumentTableDef
}

export const mergeDefaultValues = <T>(defaultValues: T, explicitDefaultValues: T): T => {
  if (
    typeof defaultValues !== 'object' ||
    typeof explicitDefaultValues !== 'object' ||
    defaultValues === null ||
    explicitDefaultValues === null
  ) {
    return explicitDefaultValues
  }

  // Get all unique keys from both objects
  const allKeys = new Set([...Object.keys(defaultValues as any), ...Object.keys(explicitDefaultValues as any)])

  return Array.from(allKeys).reduce((acc, key) => {
    acc[key] = (explicitDefaultValues as any)[key] ?? (defaultValues as any)[key]
    return acc
  }, {} as any)
}

/**
 * Creates an optimistic schema that accepts historical event formats
 * and transforms them to the current schema, preserving data and intent.
 *
 * Decision Matrix for Schema Changes:
 *
 * | Change Type         | Partial Set         | Full Set                        | Strategy                |
 * |---------------------|---------------------|----------------------------------|-------------------------|
 * | **Compatible Changes**                                                                                 |
 * | Add optional field  | Preserve existing   | Preserve existing, new field undefined | Direct decode or merge   |
 * | Add required field  | Preserve existing   | Preserve existing, new field from default | Merge with defaults      |
 * | **Incompatible Changes**                                                                              |
 * | Remove field        | Drop removed field  | Drop removed field, preserve others     | Filter & decode         |
 * | Type change         | Use default for field | Use default for changed field         | Selective merge         |
 * | Rename field        | Use default         | Use default (can't detect rename)       | Fall back to default    |
 * | **Edge Cases**                                                                                       |
 * | Empty event         | Return {}           | Return full default                     | Fallback handling       |
 * | Invalid structure   | Return {}           | Return full default                     | Fallback handling       |
 */
export const createOptimisticEventSchema = ({
  valueSchema,
  defaultValue,
  partialSet,
}: {
  valueSchema: Schema.Schema<any, any>
  defaultValue: any
  partialSet: boolean
}) => {
  const targetSchema = partialSet ? Schema.partial(valueSchema) : valueSchema

  return Schema.transform(
    Schema.Unknown, // Accept any historical event structure
    targetSchema, // Output current schema
    {
      decode: (eventValue) => {
        // Try direct decode first (for current schema events)
        try {
          return Schema.decodeUnknownSync(targetSchema)(eventValue)
        } catch {
          // Optimistic decoding for historical events

          // Handle null/undefined/non-object cases
          if (typeof eventValue !== 'object' || eventValue === null) {
            console.warn(`Client document: Non-object event value, using ${partialSet ? 'empty partial' : 'defaults'}`)
            return partialSet ? {} : defaultValue
          }

          if (partialSet) {
            // For partial sets: only preserve fields that exist in new schema
            const partialResult: Record<string, unknown> = {}
            let hasValidFields = false

            for (const [key, value] of Object.entries(eventValue as Record<string, unknown>)) {
              if (key in defaultValue) {
                partialResult[key] = value
                hasValidFields = true
              }
              // Drop fields that don't exist in new schema
            }

            if (hasValidFields) {
              try {
                return Schema.decodeUnknownSync(targetSchema)(partialResult)
              } catch {
                // Even filtered fields don't match schema
                console.warn('Client document: Partial fields incompatible, returning empty partial')
                return {}
              }
            }
            return {}
          } else {
            // Full set: merge old data with new defaults
            const merged: Record<string, unknown> = { ...defaultValue }

            // Override defaults with valid fields from old event
            for (const [key, value] of Object.entries(eventValue as Record<string, unknown>)) {
              if (key in defaultValue) {
                merged[key] = value
              }
              // Drop fields that don't exist in new schema
            }

            // Try to decode the merged value
            try {
              return Schema.decodeUnknownSync(valueSchema)(merged)
            } catch {
              // Merged value still doesn't match (e.g., type changes)
              // Fall back to pure defaults
              console.warn('Client document: Could not preserve event data, using defaults')
              return defaultValue
            }
          }
        }
      },
      encode: (value) => value, // Pass-through for encoding
    },
  )
}

export const deriveEventAndMaterializer = ({
  name,
  valueSchema,
  defaultValue,
  partialSet,
}: {
  name: string
  valueSchema: Schema.Schema<any, any>
  defaultValue: any
  partialSet: boolean
}) => {
  const derivedSetEventDef = defineEvent({
    name: `${name}Set`,
    schema: Schema.Struct({
      id: Schema.Union(Schema.String, Schema.UniqueSymbolFromSelf(SessionIdSymbol)),
      value: createOptimisticEventSchema({ valueSchema, defaultValue, partialSet }),
    }).annotations({ title: `${name}Set:Args` }),
    clientOnly: true,
    derived: true,
  })

  const derivedSetMaterializer = defineMaterializer(derivedSetEventDef, ({ id, value }) => {
    if (id === SessionIdSymbol) {
      return shouldNeverHappen(`SessionIdSymbol needs to be replaced before materializing the set event`)
    }

    // Override the full value if it's not an object or no partial set is allowed
    const schemaProps = SchemaAST.getPropertySignatures(valueSchema.ast)
    if (schemaProps.length === 0 || partialSet === false) {
      const valueColJsonSchema = Schema.parseJson(valueSchema)
      const encodedInsertValue = Schema.encodeSyncDebug(valueColJsonSchema)(value ?? defaultValue)
      const encodedUpdateValue = Schema.encodeSyncDebug(valueColJsonSchema)(value)

      return {
        sql: `INSERT INTO '${name}' (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = ?`,
        bindValues: [id, encodedInsertValue, encodedUpdateValue],
        writeTables: new Set([name]),
      }
    } else {
      const valueColJsonSchema = Schema.parseJson(Schema.partial(valueSchema))

      const encodedInsertValue = Schema.encodeSyncDebug(valueColJsonSchema)(mergeDefaultValues(defaultValue, value))

      let jsonSetSql = 'value'
      const setBindValues: unknown[] = []

      const keys = Object.keys(value)
      const partialUpdateSchema = valueSchema.pipe(Schema.pick(...keys))
      const encodedPartialUpdate = Schema.encodeSyncDebug(partialUpdateSchema)(value)

      for (const key in encodedPartialUpdate) {
        const encodedValueForKey = encodedPartialUpdate[key]
        // Skipping undefined values
        if (encodedValueForKey === undefined) {
          continue
        }
        jsonSetSql = `json_set(${jsonSetSql}, ?, json(?))`
        setBindValues.push(`$.${key}`, JSON.stringify(encodedValueForKey))
      }

      const onConflictClause =
        setBindValues.length > 0
          ? `ON CONFLICT (id) DO UPDATE SET value = ${jsonSetSql}`
          : 'ON CONFLICT (id) DO NOTHING'

      const sqlQuery = `
      INSERT INTO '${name}' (id, value)
      VALUES (?, ?)
      ${onConflictClause}
    `

      return {
        sql: sqlQuery,
        bindValues: [id, encodedInsertValue, ...setBindValues],
        writeTables: new Set([name]),
      }
    }
  })

  return { eventDef: derivedSetEventDef, materializer: derivedSetMaterializer }
}

export const tableIsClientDocumentTable = <TTableDef extends TableDefBase>(
  tableDef: TTableDef,
): tableDef is TTableDef & {
  options: { isClientDocumentTable: true }
} & ClientDocumentTableDef.Trait<TTableDef['sqliteDef']['name'], any, any, any> =>
  tableDef.options.isClientDocumentTable === true

const makeGetQueryBuilder = <TTableDef extends ClientDocumentTableDef<any, any, any, any>>(
  getTableDef: () => TTableDef,
): ClientDocumentTableDef.MakeGetQueryBuilder<any, any, any> => {
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

    const query = sql`SELECT * FROM '${tableDef.sqliteDef.name}' WHERE id = ?`

    return {
      [QueryBuilderTypeId]: QueryBuilderTypeId,
      [QueryBuilderAstSymbol]: ast,
      ResultType: 'only-for-type-inference' as any,
      asSql: () => ({ query, bindValues: [id] }),
      toString: () => query.toString(),
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

  type IsStructLike<T> = T extends {} ? true : false

  export type WithDefaults<TInput extends Input<any>> = {
    partialSet: TInput['partialSet'] extends false
      ? false
      : IsStructLike<TInput['default']['value']> extends true
        ? true
        : false
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
  ClientDocumentTableDef.SqliteDef<TName, TType>,
  {
    isClientDocumentTable: true
  }
> &
  ClientDocumentTableDef.Trait<TName, TType, TEncoded, TOptions>

export namespace ClientDocumentTableDef {
  export type Any = ClientDocumentTableDef<any, any, any, any>

  export type SqliteDef<TName extends string, TType> = SqliteDsl.TableDefinition<
    TName,
    {
      id: SqliteDsl.ColumnDefinition<string, string> & { default: Option.Some<string> }
      value: SqliteDsl.ColumnDefinition<string, TType> & { default: Option.Some<TType> }
    }
  >

  export type TableDefBase_<TName extends string, TType> = TableDefBase<
    SqliteDef<TName, TType>,
    {
      isClientDocumentTable: true
    }
  >

  export interface Trait<TName extends string, TType, TEncoded, TOptions extends ClientDocumentTableOptions<TType>> {
    /**
     * Get the current value of the client document table.
     *
     * @example
     * ```ts
     * const someDocumentTable = State.SQLite.clientDocument({
     *   name: 'SomeDocumentTable',
     *   schema: Schema.Struct({
     *     someField: Schema.String,
     *   }),
     *   default: { value: { someField: 'some-value' } },
     * })
     *
     * const value$ = queryDb(someDocumentTable.get('some-id'))
     *
     * // When you've set a default id, you can omit the id argument
     *
     * const uiState = State.SQLite.clientDocument({
     *   name: 'UiState',
     *   schema: Schema.Struct({
     *     someField: Schema.String,
     *   }),
     *   default: { id: SessionIdSymbol, value: { someField: 'some-value' } },
     * })
     *
     * const value$ = queryDb(uiState.get())
     * ```
     */
    readonly get: MakeGetQueryBuilder<TName, TType, TOptions>
    /**
     * Derived event definition for setting the value of the client document table.
     * If the document doesn't exist yet, the first .set event will create it.
     *
     * @example
     * ```ts
     * const someDocumentTable = State.SQLite.clientDocument({
     *   name: 'SomeDocumentTable',
     *   schema: Schema.Struct({
     *     someField: Schema.String,
     *     someOtherField: Schema.String,
     *   }),
     *   default: { value: { someField: 'some-default-value', someOtherField: 'some-other-default-value' } },
     * })
     *
     * const setEventDef = store.commit(someDocumentTable.set({ someField: 'explicit-value' }, 'some-id'))
     * // Will commit an event with the following payload:
     * // { id: 'some-id', value: { someField: 'explicit-value', someOtherField: 'some-other-default-value' } }
     * ```
     *
     * Similar to `.get`, you can omit the id argument if you've set a default id.
     *
     * @example
     * ```ts
     * const uiState = State.SQLite.clientDocument({
     *   name: 'UiState',
     *   schema: Schema.Struct({ someField: Schema.String }),
     *   default: { id: SessionIdSymbol, value: { someField: 'some-default-value' } },
     * })
     *
     * const setEventDef = store.commit(uiState.set({ someField: 'explicit-value' }))
     * // Will commit an event with the following payload:
     * // { id: '...', value: { someField: 'explicit-value' } }
     * //        ^^^
     * //        Automatically replaced with the client session id
     * ```
     */
    readonly set: SetEventDefLike<TName, TType, TOptions>
    readonly Value: TType
    readonly valueSchema: Schema.Schema<TType, TEncoded>
    readonly default: TOptions['default']
    readonly [ClientDocumentTableDefSymbol]: {
      readonly options: TOptions
      readonly derived: {
        readonly setEventDef: SetEventDef<TName, TType, TOptions>
        readonly setMaterializer: Materializer<SetEventDef<TName, TType, TOptions>>
      }
    }
  }

  export type GetOptions<TTableDef extends TraitAny> = TTableDef extends ClientDocumentTableDef.Trait<
    any,
    any,
    any,
    infer TOptions
  >
    ? TOptions
    : never

  export type TraitAny = Trait<any, any, any, any>

  export type DefaultIdType<TTableDef extends TraitAny> = TTableDef extends ClientDocumentTableDef.Trait<
    any,
    any,
    any,
    infer TOptions
  >
    ? TOptions['default']['id'] extends SessionIdSymbol | string
      ? TOptions['default']['id']
      : never
    : never

  export type SetEventDefLike<
    TName extends string,
    TType,
    TOptions extends ClientDocumentTableOptions<TType>,
  > = (TOptions['default']['id'] extends undefined // Helper to create partial event
    ? (
        args: TOptions['partialSet'] extends false ? TType : Partial<TType>,
        id: string | SessionIdSymbol,
      ) => { name: `${TName}Set`; args: { id: string; value: TType } }
    : (
        args: TOptions['partialSet'] extends false ? TType : Partial<TType>,
        id?: string | SessionIdSymbol,
      ) => { name: `${TName}Set`; args: { id: string; value: TType } }) & {
    readonly name: `${TName}Set`
    readonly schema: Schema.Schema<any>
    readonly Event: {
      readonly name: `${TName}Set`
      readonly args: { id: string; value: TType }
    }
    readonly options: { derived: true; clientOnly: true; facts: undefined }
  }

  export type SetEventDef<TName extends string, TType, TOptions extends ClientDocumentTableOptions<TType>> = EventDef<
    TName,
    TOptions['partialSet'] extends false ? { id: string; value: TType } : { id: string; value: Partial<TType> },
    any,
    true
  >

  export type MakeGetQueryBuilder<
    TName extends string,
    TType,
    TOptions extends ClientDocumentTableOptions<TType>,
  > = TOptions extends ClientDocumentTableOptions<TType> & { default: { id: string | SessionIdSymbol } }
    ? (
        id?: TOptions['default']['id'] | SessionIdSymbol,
        options?: { default: Partial<TType> },
      ) => QueryBuilder<TType, ClientDocumentTableDef.TableDefBase_<TName, TType>, QueryBuilder.ApiFeature>
    : (
        id: string | SessionIdSymbol,
        options?: { default: Partial<TType> },
      ) => QueryBuilder<TType, ClientDocumentTableDef.TableDefBase_<TName, TType>, QueryBuilder.ApiFeature>
}

export const ClientDocumentTableDefSymbol = Symbol('ClientDocumentTableDef')
export type ClientDocumentTableDefSymbol = typeof ClientDocumentTableDefSymbol
