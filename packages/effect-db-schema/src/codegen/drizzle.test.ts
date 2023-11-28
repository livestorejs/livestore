import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as Schema from '@effect/schema/Schema'
import { describe, test } from 'vitest'

import * as AstSqlite from '../ast/sqlite.js'
import * as sqlite from '../dsl/sqlite/index.js'
import { printSqliteDbSchema, printSqliteDrizzleTables } from './drizzle.js'

describe('drizzle sqlite printer', () => {
  test('should print sqlite with raw ast', () => {
    class UserMetaInfo extends Schema.Class<UserMetaInfo>()({
      createdAt: Schema.dateFromString(Schema.string),
      updatedAt: Schema.dateFromString(Schema.string),
    }) {}

    const userTableAst = AstSqlite.table(
      'users',
      [
        {
          _tag: 'column',
          name: 'id',
          primaryKey: true,
          default: undefined,
          nullable: false,
          type: { _tag: 'text' },
          codec: Schema.string,
        },
        {
          _tag: 'column',
          name: 'metaInfo',
          primaryKey: false,
          default: undefined,
          nullable: false,
          type: { _tag: 'text' },
          codec: UserMetaInfo,
        },
        {
          _tag: 'column',
          name: 'isCool',
          primaryKey: false,
          default: undefined,
          nullable: false,
          type: { _tag: 'integer' },
          codec: Schema.transform(
            Schema.number,
            Schema.boolean,
            (_) => _ === 1,
            (_) => (_ ? 1 : 0),
          ),
        },
      ],
      [
        {
          _tag: 'index',
          unique: true,
          name: 'my-unique-index',
          columns: ['id'],
        },
      ],
    )

    const todoTableAst = AstSqlite.table(
      'todos',
      [
        {
          _tag: 'column',
          name: 'id',
          primaryKey: true,
          default: undefined,
          nullable: false,
          type: { _tag: 'text' },
          codec: Schema.string,
        },
        {
          _tag: 'column',
          name: 'text',
          primaryKey: false,
          default: undefined,
          nullable: false,
          type: { _tag: 'text' },
          codec: Schema.string,
        },
        {
          _tag: 'column',
          name: 'isCool',
          primaryKey: false,
          default: undefined,
          nullable: false,
          type: { _tag: 'integer' },
          codec: Schema.transform(
            Schema.number,
            Schema.boolean,
            (_) => _ === 1,
            (_) => (_ ? 1 : 0),
          ),
        },
      ],
      [
        {
          _tag: 'index',
          unique: true,
          name: 'weird valid name',
          columns: ['text', 'isCool'],
        },
      ],
    )

    const str = printSqliteDrizzleTables([userTableAst, todoTableAst])

    const currentModulePath = fileURLToPath(import.meta.url)
    const currentDirectory = dirname(currentModulePath)
    const filePath = join(currentDirectory, './__generated__/drizzle/raw-ast.ts')
    fs.writeFileSync(filePath, str)
  })

  test('should print sqlite with dsl', () => {
    class UserMetaInfo extends Schema.Class<UserMetaInfo>()({
      createdAt: Schema.dateFromString(Schema.string),
      updatedAt: Schema.dateFromString(Schema.string),
    }) {}

    const users = sqlite.table('users', {
      id: sqlite.text({ primaryKey: true }),
      metaInfo: sqlite.json({ schema: UserMetaInfo }),
      isCool: sqlite.boolean({ nullable: true }),
      createdAt: sqlite.datetime({ nullable: true, default: new Date('2023-10-01T13:54:43.861Z') }),
    })

    const dbSchema = sqlite.makeDbSchema({ users })

    const str = printSqliteDbSchema(dbSchema)

    const currentModulePath = fileURLToPath(import.meta.url)
    const currentDirectory = dirname(currentModulePath)
    const filePath = join(currentDirectory, './__generated__/drizzle/dsl.ts')
    fs.writeFileSync(filePath, str)
  })
})
