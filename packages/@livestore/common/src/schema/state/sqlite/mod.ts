import { shouldNeverHappen } from '@livestore/utils'

import type { MigrationOptions } from '../../../adapter-types.ts'
import type { Materializer } from '../../EventDef/mod.ts'
import {
  type InternalState,
  type InternalStateBackend,
  isValidStateBackendId,
  type StateBackendId,
} from '../../schema.ts'
import { ClientDocumentTableDefSymbol, tableIsClientDocumentTable } from './client-document-def.ts'
import { SqliteAst } from './db-schema/mod.ts'
import { stateSystemTables } from './system-tables/state-tables.ts'
import { setTableBackendId, type TableDef, type TableDefBase } from './table-def.ts'

export * from '../../EventDef/mod.ts'
export {
  type ClientDocumentTableDef,
  ClientDocumentTableDefSymbol,
  type ClientDocumentTableOptions,
  clientDocument,
  createOptimisticEventSchema,
  tableIsClientDocumentTable,
} from './client-document-def.ts'
export * from './column-annotations.ts'
export * from './column-spec.ts'
export * from './table-def.ts'

export const makeBackend = <TStateInput extends SqliteStateBackendInput>(
  inputSchema: TStateInput,
): SqliteStateBackend => {
  if (!isValidStateBackendId(inputSchema.id)) {
    return shouldNeverHappen(`Invalid backend id "${inputSchema.id}". Backend IDs must match /^[a-zA-Z0-9_-]+$/.`)
  }

  const inputTables: ReadonlyArray<TableDef> = Array.isArray(inputSchema.tables)
    ? inputSchema.tables
    : Object.values(inputSchema.tables)

  const tables = new Map<string, TableDef.Any>()

  for (const tableDef of inputTables) {
    const sqliteDef = tableDef.sqliteDef
    // TODO validate tables (e.g. index names are unique)
    if (tables.has(sqliteDef.ast.name)) {
      shouldNeverHappen(`Duplicate table name: ${sqliteDef.ast.name}. Please use unique names for tables.`)
    }
    setTableBackendId(tableDef, inputSchema.id)
    tables.set(sqliteDef.ast.name, tableDef)
  }

  // System tables are added to every backend map so migrations and boot logic stay local to each backend DB.
  for (const tableDef of stateSystemTables) {
    tables.set(tableDef.sqliteDef.name, tableDef)
  }

  const materializers = new Map<string, Materializer<any>>()

  for (const [name, materializer] of Object.entries(inputSchema.materializers)) {
    materializers.set(name, materializer)
  }

  for (const tableDef of inputTables) {
    if (tableIsClientDocumentTable(tableDef)) {
      materializers.set(
        tableDef[ClientDocumentTableDefSymbol].derived.setEventDef.name,
        tableDef[ClientDocumentTableDefSymbol].derived.setMaterializer,
      )
    }
  }

  const hash = SqliteAst.hash({
    _tag: 'dbSchema',
    tables: [...tables.values()].map((_) => _.sqliteDef.ast),
  })
  const migrations = inputSchema.migrations ?? { strategy: 'auto' }

  return {
    id: inputSchema.id,
    backend: { kind: 'sqlite', tables, migrations, hash },
    materializers,
  }
}

export const makeMultiState = ({
  backends,
  defaultBackendId,
}: {
  backends: ReadonlyArray<SqliteStateBackend>
  defaultBackendId?: StateBackendId
}): InternalState => {
  if (backends.length === 0) {
    return shouldNeverHappen('makeMultiState requires at least one backend.')
  }

  const stateBackends = new Map<StateBackendId, InternalStateBackend>()
  const materializers = new Map<string, Materializer<any>>()
  const materializersByEventName = new Map<
    string,
    {
      backendId: StateBackendId
      materializer: Materializer<any>
    }
  >()

  for (const backend of backends) {
    if (!isValidStateBackendId(backend.id)) {
      return shouldNeverHappen(`Invalid backend id "${backend.id}". Backend IDs must match /^[a-zA-Z0-9_-]+$/.`)
    }
    if (stateBackends.has(backend.id)) {
      return shouldNeverHappen(`Duplicate backend id "${backend.id}".`)
    }
    stateBackends.set(backend.id, backend.backend)

    for (const [eventName, materializer] of backend.materializers.entries()) {
      if (materializersByEventName.has(eventName)) {
        return shouldNeverHappen(
          `Duplicate event name "${eventName}" across backends. Event names must be globally unique.`,
        )
      }
      materializers.set(eventName, materializer)
      materializersByEventName.set(eventName, {
        backendId: backend.id,
        materializer,
      })
    }
  }

  const resolvedDefaultBackendId = defaultBackendId ?? backends[0]!.id
  const defaultBackend = stateBackends.get(resolvedDefaultBackendId)
  if (defaultBackend === undefined) {
    return shouldNeverHappen(`Default backend "${resolvedDefaultBackendId}" was not found in backends.`)
  }

  return {
    backend: defaultBackend,
    backends: stateBackends,
    defaultBackendId: resolvedDefaultBackendId,
    materializers,
    materializersByEventName,
  }
}

export const makeState = <TStateInput extends InputState>(inputSchema: TStateInput): InternalState => {
  const backend = makeBackend({
    id: 'default',
    ...inputSchema,
  })

  return {
    ...makeMultiState({ backends: [backend] }),
  }
}

export type SqliteStateBackendInput = {
  readonly id: StateBackendId
  readonly tables: Record<string, TableDefBase> | ReadonlyArray<TableDefBase>
  readonly materializers: Record<string, Materializer<any>>
  /**
   * @default { strategy: 'auto' }
   */
  readonly migrations?: MigrationOptions
}

export type SqliteStateBackend = {
  readonly id: StateBackendId
  readonly backend: InternalStateBackend
  readonly materializers: Map<string, Materializer<any>>
}

export type InputState = {
  readonly tables: Record<string, TableDefBase> | ReadonlyArray<TableDefBase>
  readonly materializers: Record<string, Materializer<any>>
  /**
   * @default { strategy: 'auto' }
   */
  readonly migrations?: MigrationOptions
}
