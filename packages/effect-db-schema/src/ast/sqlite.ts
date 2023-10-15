import * as Schema from '@effect/schema/Schema'

import { hashCode } from '../hash.js'

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
  default: string | number | Uint8Array | null | undefined
  codec: Schema.Schema<any>
}

export const column = (props: Omit<Column, '_tag'>): Column => ({ _tag: 'column', ...props })

export type Index = {
  _tag: 'index'
  columns: string[]
  name?: string
  unique?: boolean
  primaryKey?: boolean
}

export const index = (columns: string[], name?: string, unique?: boolean, primaryKey?: boolean): Index => ({
  _tag: 'index',
  columns,
  name,
  unique,
  primaryKey,
})

export type ForeignKey = {
  _tag: 'foreignKey'
  references: {
    table: string
    columns: string[]
  }
  key: {
    table: string
    columns: string[]
  }
  columns: string[]
}

export type Table = {
  _tag: 'table'
  name: string
  columns: Column[]
  indexes: Index[]
}

export const table = (name: string, columns: Column[], indexes: Index[]): Table => ({
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

// TODO refine hashing implementation to only hash the relevant parts of the schema
export const hash = (obj: Table | Column | Index | ForeignKey | DbSchema): number => hashCode(JSON.stringify(obj))

export const structSchemaForTable = (tableDef: Table) =>
  Schema.struct(
    Object.fromEntries(
      tableDef.columns.map((column) => [column.name, column.nullable ? Schema.nullable(column.codec) : column.codec]),
    ),
  )
