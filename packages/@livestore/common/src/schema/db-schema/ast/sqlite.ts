import { type Option, Schema } from '@livestore/utils/effect'

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
  name,
  unique,
  primaryKey,
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
 * NOTE we're only including SQLite-relevant information in the hash (which excludes the schema mapping)
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
      return {
        _tag: 'column',
        name: obj.name,
        type: obj.type._tag,
        primaryKey: obj.primaryKey,
        nullable: obj.nullable,
        default: obj.default,
      }
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
