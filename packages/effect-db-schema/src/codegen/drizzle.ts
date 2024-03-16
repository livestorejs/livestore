import * as SchemaAST from '@effect/schema/AST'
import { Option } from 'effect'

import type * as SqliteAst from '../ast/sqlite.js'
import type * as sqlite from '../dsl/sqlite/index.js'
import { pretty } from './utils.js'

const getImports = (neededImports: Set<string>) => {
  let formattedImports = Array.from(neededImports).join(', ')
  if (formattedImports.length > 0) {
    formattedImports = `, ${formattedImports}`
  }
  return `import { sqliteTable${formattedImports} } from 'drizzle-orm/sqlite-core';`
}

const columnTypeToDrizzleType = (columnType: SqliteAst.ColumnType.ColumnType): string => {
  return columnType._tag
}

const validateTables = (tables: SqliteAst.Table[]): void => {
  const tableNames = new Set<string>()

  for (const table of tables) {
    if (tableNames.has(table.name)) {
      throw new Error(`Duplicate table name: ${table.name}`)
    }
    tableNames.add(table.name)
    if (!isValidSQLiteTableName(table.name)) {
      throw new Error(`Invalid table name: ${table.name}`)
    }
    for (const index of table.indexes) {
      if (index.name && !isValidSQLiteIndexName(index.name)) {
        throw new Error(`Invalid index name: ${index.name}`)
      }
    }
  }
}

const isValidSQLiteTableName = (tableName: string) => {
  // Check for NULL character
  if (tableName.includes('\0')) {
    return false
  }

  // Check length
  if (tableName.length > 128) {
    return false
  }

  // Check if name is alphanumeric + underscore and does not start with a digit
  if (!/^[A-Z_a-z]\w*$/.test(tableName)) {
    return false
  }

  // List of SQLite reserved words (this is a subset for demonstration purposes)
  const reservedWords = ['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'JOIN', 'TABLE']
  if (reservedWords.includes(tableName.toUpperCase())) {
    return false
  }

  return true
}

const isValidSQLiteIndexName = (indexName: string) => {
  // Check for NULL character
  if (indexName.includes('\0')) {
    return false
  }

  // Check length
  if (indexName.length > 128) {
    return false
  }

  // List of SQLite reserved words (this is a subset for demonstration purposes)
  const reservedWords = ['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'JOIN']
  if (reservedWords.includes(indexName.toUpperCase())) {
    return false
  }

  return true
}

export const printSqliteDbSchema = (schema: sqlite.DbSchema): string => {
  const tables = Object.values(schema).map((t) => t.ast)

  return printSqliteDrizzleTables(tables)
}

export const printSqliteDrizzleTables = (tables: SqliteAst.Table[]): string => {
  validateTables(tables)

  const usedImports = new Set<string>()

  const tablesString = tables
    .map((table) => {
      const { name, columns, indexes } = table

      // we're indexing the indexes
      // indexception
      const indexedIndexes = indexes.reduce<{
        single: Record<string, SqliteAst.Index>
        multi: SqliteAst.Index[]
      }>(
        (acc, index) => {
          if (index.columns.length === 1 && index.unique) {
            acc.single[index.columns[0]!] = index
          } else {
            acc.multi.push(index)
          }
          return acc
        },
        {
          single: {},
          multi: [],
        },
      )

      const columnString = columns
        .map((column) => {
          const {
            name,
            type,
            schema: { ast },
            primaryKey,
            nullable,
            default: defaultOpt,
          } = column
          const typeString = columnTypeToDrizzleType(type)
          usedImports.add(typeString)
          // next features: primary key, foreign key, unique, not null, default

          let mode = ''

          let isTimeStamp = false

          const unpackedAst = unpackNullableAst(ast).pipe(Option.getOrElse(() => ast))

          if (SchemaAST.isTransform(unpackedAst)) {
            const { to: to_ } = unpackedAst
            const to = SchemaAST.isRefinement(to_) ? to_.from : to_

            if (SchemaAST.isBooleanKeyword(to)) {
              mode = ', { mode: "boolean" }'
            } else if (SchemaAST.isDeclaration(to)) {
              const opt = SchemaAST.getAnnotation(SchemaAST.IdentifierAnnotationId)(to)
              if (opt._tag === 'Some' && opt.value === 'DateFromSelf') {
                mode = ', { mode: "timestamp" }'
                isTimeStamp = true
              }
            }
          }

          let str = `${name}: ${typeString}('${name}'${mode})`

          if (primaryKey) {
            str += '.primaryKey()'
          }

          if (nullable === false) {
            str += '.notNull()'
          }

          if (defaultOpt._tag === 'Some') {
            if (isTimeStamp) {
              str += `.default(new Date(${JSON.stringify(defaultOpt.value)}))`
            } else {
              str += `.default(${JSON.stringify(defaultOpt.value)})`
            }
          }

          const uniqueIndex = indexedIndexes.single[name]
          if (uniqueIndex) {
            str += `.unique(${uniqueIndex.name ? JSON.stringify(uniqueIndex.name) : ''})`
          }

          return str
        })
        .join(',\n')

      const multiColumnIndexString = indexedIndexes.multi
        .map((index, i) => {
          const { columns, unique, name } = index
          if (unique) {
            usedImports.add('unique')
          } else {
            throw new Error('not implemented')
          }

          const key = unique ? `unique${i || ''}` : `index${i || ''}`

          return `${key}: unique(${JSON.stringify(name) || ''}).on(${columns.map((c) => `t.${c}`).join(', ')})`
        })
        .join(',\n')

      const indexString = multiColumnIndexString.length > 0 ? `, (t) => ({\n${multiColumnIndexString}})` : ''

      return `export const ${name} = sqliteTable('${name}', {
  ${columnString}
}${indexString})`
    })
    .join('\n\n')

  const str = `${getImports(usedImports)}

${tablesString}
`

  // return str
  return pretty(str)
}

const unpackNullableAst = (ast: SchemaAST.AST): Option.Option<SchemaAST.AST> => {
  if (SchemaAST.isUnion(ast) === false) return Option.none()

  const filteredTypes = ast.types.filter((t) => t._tag !== 'Literal' || t.literal !== null)

  if (filteredTypes.length === 1) {
    return Option.some(filteredTypes[0]!)
  }

  return Option.some(SchemaAST.Union.make(filteredTypes))
}
