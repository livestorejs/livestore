import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { SessionIdSymbol } from './adapter-types.js'
import type { SqliteDsl } from './schema/db-schema/mod.js'
import type { Materializer, MutationDef } from './schema/mutations.js'
import { defineEvent, defineMaterializer } from './schema/mutations.js'
import { getDefaultValuesDecoded } from './schema/schema-helpers.js'
import type * as DbSchema from './schema/table-def.js'

// export const makeClientDocumentSetLiveStoreEvent = <
//   TTableDef extends DbSchema.TableDefBase & DbSchema.ClientDocumentTableDef.TraitAny,
// >(
//   tableDef: TTableDef,
// ) => {
//   return defineEvent({
//     name: `${tableDef.sqliteDef.name}Set`,
//     schema: tableDef.documentSchema,
//     derived: true,
//     clientOnly: true,
//   })
// }

export const makeClientDocumentSetMaterializer = <
  TTableDef extends DbSchema.ClientDocumentTableDef<any, any, any, any>,
>(
  tableDef: TTableDef,
) => {
  return defineMaterializer(tableDef.set, ({ id, ...values }) => {
    const { query, bindValues } = tableDef
      .insert({ id, ...values })
      .onConflict('id', 'update', values)
      .asSql()

    return { sql: query, bindValues, writeTables: new Set([tableDef.sqliteDef.name]) }
  })
}

export const makeDerivedMutationDefsForTable = <
  TTableDef extends DbSchema.TableDefBase<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveEvents: { enabled: true } }
  >,
>(
  table: TTableDef,
) => ({
  [`${table.sqliteDef.name}Created`]: deriveCreateMutationDef(table),
  [`${table.sqliteDef.name}Updated`]: deriveUpdateMutationDef(table),
})

export const makeDerivedMaterializersForTable = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveEvents: { enabled: true } }
  >,
>(
  table: TTableDef,
) => ({
  [`${table.sqliteDef.name}Created`]: deriveCreateMaterializer(table),
  [`${table.sqliteDef.name}Updated`]: deriveUpdateMaterializer(table),
})

export const deriveCreateMutationDef = <
  TTableDef extends DbSchema.TableDefBase<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveEvents: { enabled: true } }
  >,
>(
  table: TTableDef,
) => {
  const tableName = table.sqliteDef.name

  return defineEvent({
    name: `${tableName}Created`,
    schema: table.insertSchema,
    derived: true,
    clientOnly: true,
  })
}

const deriveCreateMaterializer = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveEvents: { enabled: true } }
  >,
>(
  table: TTableDef,
) =>
  defineMaterializer(deriveCreateMutationDef(table), ({ id, ...explicitDefaultValues }) => {
    const tableName = table.sqliteDef.name
    const defaultValues = getDefaultValuesDecoded(table, explicitDefaultValues)

    const { query, bindValues } = table.insert({ ...defaultValues, id }).asSql()

    return { sql: query, bindValues, writeTables: new Set([tableName]) }
  })

export const deriveUpdateMutationDef = <
  TTableDef extends DbSchema.TableDefBase<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveEvents: { enabled: true } }
  >,
>(
  table: TTableDef,
) => {
  const tableName = table.sqliteDef.name

  return defineEvent({
    name: `${tableName}Updated`,
    schema: Schema.extend(
      table.rowSchema.pipe(Schema.omit('id'), Schema.partial),
      table.rowSchema.pipe(Schema.pick('id')),
    ).annotations({
      title: `${tableName}Updated:Args`,
    }),
    derived: true,
    clientOnly: true,
  })
}

const deriveUpdateMaterializer = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveEvents: { enabled: true } }
  >,
>(
  table: TTableDef,
) => {
  const tableName = table.sqliteDef.name

  return defineMaterializer(deriveUpdateMutationDef(table), ({ id, ...values }) => {
    if (id === undefined) {
      return shouldNeverHappen(`id is required for update mutation for table ${tableName}`)
    }

    const { query, bindValues } = table.update(values).where('id', id).asSql()

    return { sql: query, bindValues, writeTables: new Set([tableName]) }
  })
}

// export const deriveDeleteMutationDef = <
//   TTableDef extends DbSchema.TableDefBase<
//     DbSchema.DefaultSqliteTableDefConstrained,
//     DbSchema.TableOptions & { deriveEvents: { enabled: true } }
//   >,
// >(
//   table: TTableDef,
// ) => {
//   const tableName = table.sqliteDef.name

//   return defineEvent({
//     name: `${tableName}Deleted`,
//     schema: Schema.Struct({
//       where: Schema.partial(table.schema),
//     }).annotations({ title: `${tableName}:Delete` }),
//     derived: true,
//     clientOnly: true,
//   })
// }

/**
 * Convenience helper functions on top of the derived mutation definitions.
 */
export type DerivedMutationHelperFns<
  TColumns extends SqliteDsl.ConstraintColumns,
  TTableName extends string = string,
> = {
  derived: {
    events: DerivedMutationHelperFns.DerivedEvents<TColumns, TTableName>
    materializers: DerivedMutationHelperFns.DerivedMaterializers<TColumns, TTableName>
  }
}

export namespace DerivedMutationHelperFns {
  export type DerivedEvents<TColumns extends SqliteDsl.ConstraintColumns, TTableName extends string> = {
    [K in `${TTableName}Created`]: DerivedMutationHelperFns.InsertMutationFn<TColumns, TTableName>
  } & {
    [K in `${TTableName}Updated`]: DerivedMutationHelperFns.UpdateMutationFn<TColumns, TTableName>
  }

  export type DerivedMaterializers<TColumns extends SqliteDsl.ConstraintColumns, TTableName extends string> = {
    [K in `${TTableName}Created`]: Materializer<InsertMutationFn<TColumns, TTableName>>
  } & {
    [K in `${TTableName}Updated`]: Materializer<UpdateMutationFn<TColumns, TTableName>>
  }
  export type InsertMutationFn<
    TColumns extends SqliteDsl.ConstraintColumns,
    TTableName extends string,
  > = SqliteDsl.AnyIfConstained<
    TColumns,
    MutationDef<
      `${TTableName}Created`,
      Omit<SqliteDsl.FromColumns.InsertRowDecoded<TColumns>, 'id'> & {
        id: GetIdColumnType<TColumns> | SessionIdSymbol
      }
    >
  >

  export type UpdateMutationFn<
    TColumns extends SqliteDsl.ConstraintColumns,
    TTableName extends string,
  > = SqliteDsl.AnyIfConstained<
    TColumns,
    MutationDef<
      `${TTableName}Updated`,
      Partial<Omit<SqliteDsl.FromColumns.RowDecoded<TColumns>, 'id'>> & { id: string | SessionIdSymbol }
    >
  >

  type GetIdColumnType<TColumns extends SqliteDsl.Columns> = TColumns extends {
    id: SqliteDsl.ColumnDefinition<infer _1, infer Type>
  }
    ? Type
    : never
}
