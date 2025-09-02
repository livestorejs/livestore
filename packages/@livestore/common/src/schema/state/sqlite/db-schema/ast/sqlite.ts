import { omitUndefineds } from '@livestore/utils'
import { type Option, Schema, SchemaAST } from '@livestore/utils/effect'

import { hashCode } from '../hash.ts'

export namespace ColumnType {
  export type ColumnType = Text | Null | Real | Integer | Blob

  export type Text = { _tag: 'text' }

  export type Null = { _tag: 'null' }

  export type Real = { _tag: 'real' }

  export type Integer = { _tag: 'integer' }

  export type Blob = { _tag: 'blob' }
}

export type Column = {
  _tag: 'column'
  name: string
  type: ColumnType.ColumnType
  primaryKey: boolean
  nullable: boolean
  autoIncrement: boolean
  default: Option.Option<any>
  schema: Schema.Schema<any>
}

export const column = (props: Omit<Column, '_tag'>): Column => ({ _tag: 'column', ...props })

export type Index = {
  _tag: 'index'
  columns: ReadonlyArray<string>
  name?: string
  unique?: boolean
  primaryKey?: boolean
}

export const index = (
  columns: ReadonlyArray<string>,
  name?: string,
  unique?: boolean,
  primaryKey?: boolean,
): Index => ({
  _tag: 'index',
  columns,
  ...omitUndefineds({ name, unique, primaryKey }),
})

export type ForeignKey = {
  _tag: 'foreignKey'
  references: {
    table: string
    columns: ReadonlyArray<string>
  }
  key: {
    table: string
    columns: ReadonlyArray<string>
  }
  columns: ReadonlyArray<string>
}

export type Table = {
  _tag: 'table'
  name: string
  columns: ReadonlyArray<Column>
  indexes: ReadonlyArray<Index>
}

export const table = (name: string, columns: ReadonlyArray<Column>, indexes: ReadonlyArray<Index>): Table => ({
  _tag: 'table',
  name,
  columns,
  indexes,
})

export type DbSchema = {
  _tag: 'dbSchema'
  tables: Table[]
}

export const dbSchema = (tables: Table[]): DbSchema => ({ _tag: 'dbSchema', tables })

/**
 * Helper to detect if a column is a JSON column (has parseJson transformation)
 */
const isJsonColumn = (column: Column): boolean => {
  if (column.type._tag !== 'text') return false

  // Check if the schema AST is a parseJson transformation
  const ast = column.schema.ast
  return ast._tag === 'Transformation' && ast.annotations.schemaId === SchemaAST.ParseJsonSchemaId
}

/**
 * NOTE we're now including JSON schema information for JSON columns
 * to detect client document schema changes
 */
export const hash = (obj: Table | Column | Index | ForeignKey | DbSchema): number =>
  hashCode(JSON.stringify(trimInfoForHasing(obj)))

const trimInfoForHasing = (obj: Table | Column | Index | ForeignKey | DbSchema): Record<string, any> => {
  switch (obj._tag) {
    case 'table': {
      return {
        _tag: 'table',
        name: obj.name,
        columns: obj.columns.map((column) => trimInfoForHasing(column)),
        indexes: obj.indexes.map((index) => trimInfoForHasing(index)),
      }
    }
    case 'column': {
      const baseInfo: Record<string, any> = {
        _tag: 'column',
        name: obj.name,
        type: obj.type._tag,
        primaryKey: obj.primaryKey,
        nullable: obj.nullable,
        autoIncrement: obj.autoIncrement,
        default: obj.default,
      }

      // NEW: Include schema hash for JSON columns
      // This ensures that changes to the JSON schema are detected
      if (isJsonColumn(obj) && obj.schema) {
        // Use Effect's Schema.hash for consistent hashing
        baseInfo.jsonSchemaHash = Schema.hash(obj.schema)
      }

      return baseInfo
    }
    case 'index': {
      return {
        _tag: 'index',
        columns: obj.columns,
        name: obj.name,
        unique: obj.unique,
        primaryKey: obj.primaryKey,
      }
    }
    case 'foreignKey': {
      return {
        _tag: 'foreignKey',
        references: obj.references,
        key: obj.key,
        columns: obj.columns,
      }
    }
    case 'dbSchema': {
      return {
        _tag: 'dbSchema',
        tables: obj.tables.map(trimInfoForHasing),
      }
    }
    default: {
      throw new Error(`Unreachable: ${obj}`)
    }
  }
}

export const structSchemaForTable = (tableDef: Table) =>
  Schema.Struct(Object.fromEntries(tableDef.columns.map((column) => [column.name, column.schema])))
