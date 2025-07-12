import { isReadonlyArray, shouldNeverHappen } from '@livestore/utils'

import type { MigrationOptions } from '../adapter-types.ts'
import type { EventDef, EventDefRecord, Materializer, RawSqlEvent } from './EventDef.ts'
import { rawSqlEvent } from './EventDef.ts'
import { tableIsClientDocumentTable } from './state/sqlite/client-document-def.ts'
import type { SqliteDsl } from './state/sqlite/db-schema/mod.ts'
import { stateSystemTables } from './state/sqlite/system-tables.ts'
import type { TableDef } from './state/sqlite/table-def.ts'

export const LiveStoreSchemaSymbol = Symbol.for('livestore.LiveStoreSchema')
export type LiveStoreSchemaSymbol = typeof LiveStoreSchemaSymbol

export interface LiveStoreSchema<
  TDbSchema extends SqliteDsl.DbSchema = SqliteDsl.DbSchema,
  TEventsDefRecord extends EventDefRecord = EventDefRecord,
> {
  readonly LiveStoreSchemaSymbol: LiveStoreSchemaSymbol
  /** Only used on type-level */
  readonly _DbSchemaType: TDbSchema
  /** Only used on type-level */
  readonly _EventDefMapType: TEventsDefRecord

  readonly state: InternalState
  readonly eventsDefsMap: Map<string, EventDef.AnyWithoutFn>
  readonly devtools: {
    /** @default 'default' */
    readonly alias: string
  }
}

// TODO abstract this further away from sqlite/tables
export interface InternalState {
  readonly sqlite: {
    readonly tables: Map<string, TableDef.Any>
    readonly migrations: MigrationOptions
    /** Compound hash of all table defs etc */
    readonly hash: number
  }
  readonly materializers: Map<string, Materializer>
}

export interface InputSchema {
  readonly events: ReadonlyArray<EventDef.AnyWithoutFn> | Record<string, EventDef.AnyWithoutFn>
  readonly state: InternalState
  readonly devtools?: {
    /**
     * This alias value is used to disambiguate between multiple schemas in the devtools.
     * Only needed when an app uses multiple schemas.
     *
     * @default 'default'
     */
    readonly alias?: string
  }
}

export const makeSchema = <TInputSchema extends InputSchema>(
  /** Note when using the object-notation for tables/events, the object keys are ignored and not used as table/mutation names */
  inputSchema: TInputSchema,
): FromInputSchema.DeriveSchema<TInputSchema> => {
  const state = inputSchema.state
  const tables = inputSchema.state.sqlite.tables

  for (const tableDef of stateSystemTables) {
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

  return {
    LiveStoreSchemaSymbol,
    _DbSchemaType: Symbol.for('livestore.DbSchemaType') as any,
    _EventDefMapType: Symbol.for('livestore.EventDefMapType') as any,
    state,
    eventsDefsMap,
    devtools: {
      alias: inputSchema.devtools?.alias ?? 'default',
    },
  } satisfies LiveStoreSchema
}

export const getEventDef = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
  eventName: string,
): {
  eventDef: EventDef.AnyWithoutFn
  materializer: Materializer
} => {
  const eventDef = schema.eventsDefsMap.get(eventName)
  if (eventDef === undefined) {
    return shouldNeverHappen(`No mutation definition found for \`${eventName}\`.`)
  }
  const materializer = schema.state.materializers.get(eventName)
  if (materializer === undefined) {
    return shouldNeverHappen(`No materializer found for \`${eventName}\`.`)
  }
  return { eventDef, materializer }
}

export namespace FromInputSchema {
  export type DeriveSchema<TInputSchema extends InputSchema> = LiveStoreSchema<
    DbSchemaFromInputSchemaTables<TInputSchema['state']['sqlite']['tables']>,
    EventDefRecordFromInputSchemaEvents<TInputSchema['events']>
  >

  /**
   * In case of ...
   * - array: we use the table name of each array item (= table definition) as the object key
   * - object: we discard the keys of the input object and use the table name of each object value (= table definition) as the new object key
   */
  type DbSchemaFromInputSchemaTables<TTables extends InputSchema['state']['sqlite']['tables']> =
    TTables extends ReadonlyArray<TableDef>
      ? { [K in TTables[number] as K['sqliteDef']['name']]: K['sqliteDef'] }
      : TTables extends Record<string, TableDef>
        ? { [K in keyof TTables as TTables[K]['sqliteDef']['name']]: TTables[K]['sqliteDef'] }
        : never

  type EventDefRecordFromInputSchemaEvents<TEvents extends InputSchema['events']> =
    TEvents extends ReadonlyArray<EventDef.Any>
      ? { [K in TEvents[number] as K['name']]: K } & { 'livestore.RawSql': RawSqlEvent }
      : TEvents extends { [name: string]: EventDef.Any }
        ? { [K in keyof TEvents as TEvents[K]['name']]: TEvents[K] } & { 'livestore.RawSql': RawSqlEvent }
        : never
}
