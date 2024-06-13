import { isReadonlyArray, shouldNeverHappen } from '@livestore/utils'
import type { ReadonlyArray } from '@livestore/utils/effect'
import { SqliteAst, type SqliteDsl } from 'effect-db-schema'

import type { MigrationOptions } from '../adapter-types.js'
import { makeDerivedMutationDefsForTable } from '../derived-mutations.js'
import {
  type MutationDef,
  type MutationDefMap,
  type MutationDefRecord,
  type RawSqlMutation,
  rawSqlMutation,
} from './mutations.js'
import { systemTables } from './system-tables.js'
import { type TableDef, tableHasDerivedMutations } from './table-def.js'

export * from './system-tables.js'
export * as DbSchema from './table-def.js'
export * as ParseUtils from './parse-utils.js'
export * from './mutations.js'
export * from './schema-helpers.js'

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
  /** Compound hash of all table defs etc */
  readonly hash: number

  migrationOptions: MigrationOptions
}

export type InputSchema = {
  readonly tables: Record<string, TableDef> | ReadonlyArray<TableDef>
  readonly mutations?: ReadonlyArray<MutationDef.Any> | Record<string, MutationDef.Any>
}

export const makeSchema = <TInputSchema extends InputSchema>(
  /** Note when using the object-notation for tables/mutations, the object keys are ignored and not used as table/mutation names */
  inputSchema: TInputSchema & {
    /** "hard-reset" is currently the default strategy */
    migrations?: MigrationOptions<FromInputSchema.DeriveSchema<TInputSchema>>
  },
): FromInputSchema.DeriveSchema<TInputSchema> => {
  const inputTables: ReadonlyArray<TableDef> = Array.isArray(inputSchema.tables)
    ? inputSchema.tables
    : Object.values(inputSchema.tables)

  const tables = new Map<string, TableDef>()

  for (const tableDef of inputTables) {
    // TODO validate tables (e.g. index names are unique)
    if (tables.has(tableDef.sqliteDef.ast.name)) {
      shouldNeverHappen(`Duplicate table name: ${tableDef.sqliteDef.ast.name}. Please use unique names for tables.`)
    }
    tables.set(tableDef.sqliteDef.ast.name, tableDef)
  }

  for (const tableDef of systemTables) {
    tables.set(tableDef.sqliteDef.name, tableDef)
  }

  const mutations: MutationDefMap = new Map()

  if (isReadonlyArray(inputSchema.mutations)) {
    for (const mutation of inputSchema.mutations) {
      mutations.set(mutation.name, mutation)
    }
  } else {
    for (const mutation of Object.values(inputSchema.mutations ?? {})) {
      if (mutations.has(mutation.name)) {
        shouldNeverHappen(`Duplicate mutation name: ${mutation.name}. Please use unique names for mutations.`)
      }
      mutations.set(mutation.name, mutation)
    }
  }

  mutations.set(rawSqlMutation.name, rawSqlMutation)

  for (const tableDef of tables.values()) {
    if (tableHasDerivedMutations(tableDef)) {
      const derivedMutationDefs = makeDerivedMutationDefsForTable(tableDef)
      mutations.set(derivedMutationDefs.insert.name, derivedMutationDefs.insert)
      mutations.set(derivedMutationDefs.update.name, derivedMutationDefs.update)
      mutations.set(derivedMutationDefs.delete.name, derivedMutationDefs.delete)
    }
  }

  const hash = SqliteAst.hash({
    _tag: 'dbSchema',
    tables: [...tables.values()].map((_) => _.sqliteDef.ast),
  })

  return {
    _DbSchemaType: Symbol('livestore.DbSchemaType') as any,
    _MutationDefMapType: Symbol('livestore.MutationDefMapType') as any,
    tables,
    mutations,
    migrationOptions: inputSchema.migrations ?? { strategy: 'hard-reset' },
    hash,
  } satisfies LiveStoreSchema
}

namespace FromInputSchema {
  export type DeriveSchema<TInputSchema extends InputSchema> = LiveStoreSchema<
    DbSchemaFromInputSchemaTables<TInputSchema['tables']>,
    MutationDefRecordFromInputSchemaMutations<TInputSchema['mutations']>
  >

  /**
   * In case of ...
   * - array: we use the table name of each array item (= table definition) as the object key
   * - object: we discard the keys of the input object and use the table name of each object value (= table definition) as the new object key
   */
  type DbSchemaFromInputSchemaTables<TTables extends InputSchema['tables']> =
    TTables extends ReadonlyArray<TableDef>
      ? { [K in TTables[number] as K['sqliteDef']['name']]: K['sqliteDef'] }
      : TTables extends Record<string, TableDef>
        ? { [K in keyof TTables as TTables[K]['sqliteDef']['name']]: TTables[K]['sqliteDef'] }
        : never

  type MutationDefRecordFromInputSchemaMutations<TMutations extends InputSchema['mutations']> =
    TMutations extends ReadonlyArray<MutationDef.Any>
      ? { [K in TMutations[number] as K['name']]: K } & { 'livestore.RawSql': RawSqlMutation }
      : TMutations extends { [name: string]: MutationDef.Any }
        ? { [K in keyof TMutations as TMutations[K]['name']]: TMutations[K] } & { 'livestore.RawSql': RawSqlMutation }
        : never
}
