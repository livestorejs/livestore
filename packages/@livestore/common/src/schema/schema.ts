import { isReadonlyArray, shouldNeverHappen } from '@livestore/utils'

import type { MigrationOptions } from '../adapter-types.js'
import { tableIsClientDocumentTable } from './client-document-def.js'
import type { SqliteDsl } from './db-schema/mod.js'
import { SqliteAst } from './db-schema/mod.js'
import type { EventDef, EventDefRecord, Materializer, RawSqlEvent } from './EventDef.js'
import { rawSqlEvent } from './EventDef.js'
import { systemTables } from './system-tables.js'
import type { TableDef } from './table-def.js'

export const LiveStoreSchemaSymbol = Symbol.for('livestore.LiveStoreSchema')
export type LiveStoreSchemaSymbol = typeof LiveStoreSchemaSymbol

export type LiveStoreSchema<
  TDbSchema extends SqliteDsl.DbSchema = SqliteDsl.DbSchema,
  TMutationsDefRecord extends EventDefRecord = EventDefRecord,
> = {
  readonly _Type: LiveStoreSchemaSymbol
  /** Only used on type-level */
  readonly _DbSchemaType: TDbSchema
  /** Only used on type-level */
  readonly _EventDefMapType: TMutationsDefRecord

  // TODO remove in favour of `state`
  readonly tables: Map<string, TableDef>
  // readonly mutations: EventDefMap
  /** Compound hash of all table defs etc */
  readonly hash: number
  readonly state: State

  readonly eventsDefsMap: Map<string, EventDef.AnyWithoutFn>

  // readonly materializers: Map<string, Materializer>

  migrationOptions: MigrationOptions
}

export type State = {
  readonly tables: Map<string, TableDef>
  // readonly tables: Map<string, TableDef | AtomTableDef>
  readonly materializers: Map<string, Materializer>
}

export type InputSchema = {
  // readonly tables?: Record<string, TableDefBase> | ReadonlyArray<TableDefBase>
  readonly events: ReadonlyArray<EventDef.AnyWithoutFn> | Record<string, EventDef.AnyWithoutFn>
  readonly state: State
  /**
   * Can be used to isolate multiple LiveStore apps running in the same origin
   */
  // TODO remove this in favour of storeId
  readonly key?: string
}

export const makeSchema = <TInputSchema extends InputSchema>(
  /** Note when using the object-notation for tables/mutations, the object keys are ignored and not used as table/mutation names */
  inputSchema: TInputSchema & {
    /** "hard-reset" is currently the default strategy */
    migrations?: MigrationOptions<FromInputSchema.DeriveSchema<TInputSchema>>
  },
): FromInputSchema.DeriveSchema<TInputSchema> => {
  // const inputTables: ReadonlyArray<TableDef> = Array.isArray(inputSchema.tables)
  //   ? inputSchema.tables
  //   : Object.values(inputSchema.tables)

  // const inputTables = []

  // const tables = new Map<string, TableDef>()

  // for (const tableDef of inputTables) {
  //   // TODO validate tables (e.g. index names are unique)
  //   if (tables.has(tableDef.sqliteDef.ast.name)) {
  //     shouldNeverHappen(`Duplicate table name: ${tableDef.sqliteDef.ast.name}. Please use unique names for tables.`)
  //   }
  //   tables.set(tableDef.sqliteDef.ast.name, tableDef)
  // }

  const state = inputSchema.state
  const tables = inputSchema.state.tables

  for (const tableDef of systemTables) {
    // // @ts-expect-error TODO fix type level issue
    tables.set(tableDef.sqliteDef.name, tableDef)
  }

  const eventsDefsMap = new Map<string, EventDef.AnyWithoutFn>()

  if (isReadonlyArray(inputSchema.events)) {
    for (const eventDef of inputSchema.events) {
      eventsDefsMap.set(eventDef.name, eventDef)
    }
  } else {
    for (const eventDef of Object.values(inputSchema.events ?? {})) {
      if (eventsDefsMap.has(eventDef.name)) {
        shouldNeverHappen(`Duplicate event name: ${eventDef.name}. Please use unique names for events.`)
      }
      eventsDefsMap.set(eventDef.name, eventDef)
    }
  }

  eventsDefsMap.set(rawSqlEvent.name, rawSqlEvent)

  for (const tableDef of tables.values()) {
    if (tableIsClientDocumentTable(tableDef) && eventsDefsMap.has(tableDef.set.name) === false) {
      eventsDefsMap.set(tableDef.set.name, tableDef.set)
    }
  }

  const hash = SqliteAst.hash({
    _tag: 'dbSchema',
    // @ts-expect-error TODO fix type level issue
    tables: [...tables.values()].map((_) => _.sqliteDef.ast ?? _.table.sqliteDef.ast),
  })

  return {
    _Type: LiveStoreSchemaSymbol,
    _DbSchemaType: Symbol.for('livestore.DbSchemaType') as any,
    _EventDefMapType: Symbol.for('livestore.EventDefMapType') as any,
    // tables,
    // mutations,
    state,
    tables: state.tables,
    eventsDefsMap,
    migrationOptions: inputSchema.migrations ?? { strategy: 'from-mutation-log' },
    hash,
  } satisfies LiveStoreSchema
}

export const getEventDef = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
  mutationName: string,
): {
  eventDef: EventDef.AnyWithoutFn
  materializer: Materializer
} => {
  const eventDef = schema.eventsDefsMap.get(mutationName)
  if (eventDef === undefined) {
    return shouldNeverHappen(`No mutation definition found for \`${mutationName}\`.`)
  }
  const materializer = schema.state.materializers.get(mutationName)
  if (materializer === undefined) {
    return shouldNeverHappen(`No materializer found for \`${mutationName}\`.`)
  }
  return { eventDef, materializer }
}

export namespace FromInputSchema {
  export type DeriveSchema<TInputSchema extends InputSchema> = LiveStoreSchema<
    DbSchemaFromInputSchemaTables<TInputSchema['state']['tables']>,
    EventDefRecordFromInputSchemaMutations<TInputSchema['events']>
  >

  /**
   * In case of ...
   * - array: we use the table name of each array item (= table definition) as the object key
   * - object: we discard the keys of the input object and use the table name of each object value (= table definition) as the new object key
   */
  type DbSchemaFromInputSchemaTables<TTables extends InputSchema['state']['tables']> =
    TTables extends ReadonlyArray<TableDef>
      ? { [K in TTables[number] as K['sqliteDef']['name']]: K['sqliteDef'] }
      : TTables extends Record<string, TableDef>
        ? { [K in keyof TTables as TTables[K]['sqliteDef']['name']]: TTables[K]['sqliteDef'] }
        : never

  type EventDefRecordFromInputSchemaMutations<TMutations extends InputSchema['events']> =
    TMutations extends ReadonlyArray<EventDef.Any>
      ? { [K in TMutations[number] as K['name']]: K } & { 'livestore.RawSql': RawSqlEvent }
      : TMutations extends { [name: string]: EventDef.Any }
        ? { [K in keyof TMutations as TMutations[K]['name']]: TMutations[K] } & { 'livestore.RawSql': RawSqlEvent }
        : never
}
