import { shouldNeverHappen } from '@livestore/utils'
import type { ReadonlyArray } from '@livestore/utils/effect'
import { Option, pipe, ReadonlyRecord, Schema, SchemaAST, TreeFormatter } from '@livestore/utils/effect'
import { SqliteDsl } from 'effect-db-schema'

import { type FromColumns, type FromTable, getDefaultValuesDecoded, type TableDef } from './table-def.js'

export const headUnsafe = <From, To>(schema: Schema.Schema<From, To>) =>
  Schema.transform(
    Schema.array(schema),
    Schema.to(schema),
    (rows) => rows[0]!,
    (row) => [row],
  )

export const head = <From, To>(schema: Schema.Schema<From, To>) =>
  Schema.transform(
    Schema.array(schema),
    Schema.optionFromSelf(Schema.to(schema)),
    (rows) => Option.fromNullable(rows[0]),
    (row) => (row._tag === 'None' ? [] : [row.value]),
  )

export const headOr = <From, To>(schema: Schema.Schema<From, To>, fallback: To) =>
  Schema.transform(
    Schema.array(schema),
    Schema.to(schema),
    (rows) => rows[0] ?? fallback,
    (row) => [row],
  )

export const pluck = <From extends {}, To, K extends keyof From & keyof To & string>(
  schema: Schema.Schema<From, To>,
  prop: K,
): Schema.Schema<From, To[K]> => {
  const toSchema = Schema.make(SchemaAST.getPropertySignatures(schema.ast).find((s) => s.name === prop)!.type) as any
  return Schema.transform(
    schema,
    toSchema,
    (row) => (row as any)[prop],
    (val) => ({ [prop]: val }) as any,
  )
}

export const schemaFor = <TTableDef extends TableDef>(
  table: TTableDef,
): Schema.Schema<FromTable.RowEncoded<TTableDef>, FromTable.RowDecoded<TTableDef>> =>
  SqliteDsl.structSchemaForTable(table.schema) as any

export const many = <TTableDef extends TableDef>(
  table: TTableDef,
): ((rawRows: ReadonlyArray<any>) => ReadonlyArray<FromTable.RowDecoded<TTableDef>>) => {
  const schema = schemaFor(table)
  return Schema.parseSync(Schema.array(schema))
}

export const firstRow =
  <TTableDef extends TableDef>(
    table: TTableDef,
    fallback?: FromColumns.InsertRowDecoded<TTableDef['schema']['columns']>,
  ) =>
  (rawRows: ReadonlyArray<any>) => {
    const schema = schemaFor(table)
    const rows = Schema.parseSync(Schema.array(schema))(rawRows)

    if (rows.length === 0) {
      const schemaDefaultValues = getDefaultValuesDecoded(table)

      const defaultValuesResult = pipe(
        table.schema.columns,
        ReadonlyRecord.map((_column, columnName) => (fallback as any)?.[columnName] ?? schemaDefaultValues[columnName]),
        Schema.validateEither(schema),
      )

      if (defaultValuesResult._tag === 'Right') {
        return defaultValuesResult.right
      } else {
        console.error('decode error', TreeFormatter.formatError(defaultValuesResult.left))
        return shouldNeverHappen(
          `Expected query (for table ${table.schema.name}) to return at least one result but found none. Also can't fallback to default values as some were not provided.`,
        )
      }
    }

    return rows[0]!
  }
