import type { ReadonlyArray } from '@livestore/utils/effect'
import type { SqliteDsl } from 'effect-db-schema'

import { isReadonlyArray } from '../utils/util.js'
import {
  type MutationDef,
  type MutationDefMap,
  type MutationDefRecord,
  type RawSqlMutation,
  rawSqlMutation,
} from './mutations.js'
import { systemTables } from './system-tables.js'
import type { TableDef } from './table-def.js'

export * from './system-tables.js'
export * as DbSchema from './table-def.js'
export * as ParseUtils from './parse-utils.js'
export * from './mutations.js'

export type LiveStoreSchema<
  TDbSchema extends SqliteDsl.DbSchema = SqliteDsl.DbSchema,
  TMutationsDefRecord extends MutationDefRecord = MutationDefRecord,
> = {
  /** Only used on type-level */
  readonly _DbSchemaType: TDbSchema
  /** Only used on type-level */
  readonly _MutationDefMapType: TMutationsDefRecord

  readonly tables: Map<string, TableDef>
  readonly mutations: MutationDefMap
}

export type InputSchema = {
  readonly tables: Record<string, TableDef> | ReadonlyArray<TableDef>
  readonly mutations?: ReadonlyArray<MutationDef.Any> | Record<string, MutationDef.Any>
}

export const makeSchema = <TInputSchema extends InputSchema>(
  /** Note when using the object-notation for tables/mutations, the object keys are ignored and not used as table/mutation names */
  schema: TInputSchema,
): LiveStoreSchema<
  DbSchemaFromInputSchemaTables<TInputSchema['tables']>,
  MutationDefRecordFromInputSchemaMutations<TInputSchema['mutations']>
> => {
  const inputTables: ReadonlyArray<TableDef> = Array.isArray(schema.tables)
    ? schema.tables
    : // TODO validate that table names are unique in this case
      Object.values(schema.tables)

  const tables = new Map<string, TableDef>()

  for (const tableDef of inputTables) {
    // TODO validate tables (e.g. index names are unique)
    tables.set(tableDef.sqliteDef.ast.name, tableDef)
  }

  for (const tableDef of systemTables) {
    tables.set(tableDef.sqliteDef.name, tableDef)
  }

  const mutations: MutationDefMap = new Map()

  if (isReadonlyArray(schema.mutations)) {
    for (const mutation of schema.mutations) {
      mutations.set(mutation.name, mutation)
    }
  } else {
    for (const [name, mutation] of Object.entries(schema.mutations ?? {})) {
      mutations.set(name, mutation)
    }
  }

  mutations.set('livestore.RawSql', rawSqlMutation)

  return {
    _DbSchemaType: Symbol('livestore.DbSchemaType') as any,
    _MutationDefMapType: Symbol('livestore.MutationDefMapType') as any,
    tables,
    mutations,
  } satisfies LiveStoreSchema
}

/**
 * In case of ...
 * - array: we use the table name of each array item (= table definition) as the object key
 * - object: we discard the keys of the input object and use the table name of each object value (= table definition) as the new object key
 */
export type DbSchemaFromInputSchemaTables<TTables extends InputSchema['tables']> =
  TTables extends ReadonlyArray<TableDef>
    ? { [K in TTables[number] as K['sqliteDef']['name']]: K['sqliteDef'] }
    : TTables extends Record<string, TableDef>
      ? { [K in keyof TTables as TTables[K]['sqliteDef']['name']]: TTables[K]['sqliteDef'] }
      : never

export type MutationDefRecordFromInputSchemaMutations<TMutations extends InputSchema['mutations']> =
  TMutations extends ReadonlyArray<MutationDef.Any>
    ? { [K in TMutations[number] as K['name']]: K } & { 'livestore.RawSql': RawSqlMutation }
    : TMutations extends { [name: string]: MutationDef.Any }
      ? { [K in keyof TMutations as TMutations[K]['name']]: TMutations[K] } & { 'livestore.RawSql': RawSqlMutation }
      : never
