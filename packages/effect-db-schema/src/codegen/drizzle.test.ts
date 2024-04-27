import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as Schema from '@effect/schema/Schema'
import { Option } from 'effect'
import { describe, test } from 'vitest'

import * as AstSqlite from '../ast/sqlite.js'
import * as sqlite from '../dsl/sqlite/index.js'
import { printSqliteDbSchema, printSqliteDrizzleTables } from './drizzle.js'

describe('drizzle sqlite printer', () => {
  test('should print sqlite with raw ast', () => {
    class UserMetaInfo extends Schema.Class<UserMetaInfo>('UserMetaInfo')({
      createdAt: Schema.Date,
      updatedAt: Schema.Date,
    }) {}

    const userTableAst = AstSqlite.table(
      'users',
      [
        {
          _tag: 'column',
          name: 'id',
          primaryKey: true,
          default: Option.none(),
          nullable: false,
          type: { _tag: 'text' },
          schema: Schema.String,
        },
        {
          _tag: 'column',
          name: 'metaInfo',
          primaryKey: false,
          default: Option.none(),
          nullable: false,
          type: { _tag: 'text' },
          schema: UserMetaInfo,
        },
        {
          _tag: 'column',
          name: 'isCool',
          primaryKey: false,
          default: Option.none(),
          nullable: false,
          type: { _tag: 'integer' },
          schema: Schema.transform(Schema.Number, Schema.Boolean, {
            decode: (_) => _ === 1,
            encode: (_) => (_ ? 1 : 0),
          }),
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
          default: Option.none(),
          nullable: false,
          type: { _tag: 'text' },
          schema: Schema.String,
        },
        {
          _tag: 'column',
          name: 'text',
          primaryKey: false,
          default: Option.none(),
          nullable: false,
          type: { _tag: 'text' },
          schema: Schema.String,
        },
        {
          _tag: 'column',
          name: 'isCool',
          primaryKey: false,
          default: Option.none(),
          nullable: false,
          type: { _tag: 'integer' },
          schema: Schema.transform(Schema.Number, Schema.Boolean, {
            decode: (_) => _ === 1,
            encode: (_) => (_ ? 1 : 0),
          }),
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
    class UserMetaInfo extends Schema.Class<UserMetaInfo>('UserMetaInfo')({
      createdAt: Schema.Date,
      updatedAt: Schema.Date,
    }) {}

    const users = sqlite.table('users', {
      id: sqlite.text({ primaryKey: true }),
      metaInfo: sqlite.json({ schema: UserMetaInfo }),
      isCool: sqlite.boolean({ nullable: true }),
      createdAt: sqlite.datetimeInteger({ nullable: true, default: new Date('2023-10-01T13:54:43.861Z') }),
    })

    const dbSchema = sqlite.makeDbSchema({ users })

    const str = printSqliteDbSchema(dbSchema)

    const currentModulePath = fileURLToPath(import.meta.url)
    const currentDirectory = dirname(currentModulePath)
    const filePath = join(currentDirectory, './__generated__/drizzle/dsl.ts')
    fs.writeFileSync(filePath, str)
  })
})
