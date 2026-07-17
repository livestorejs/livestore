import { TestSchema } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { Schema, SchemaTransformation } from '@livestore/utils/effect'

import { State } from '../../../mod.ts'
import { getResultSchema } from './impl.ts'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    status: State.SQLite.text({ schema: Schema.Literals(['active', 'completed']) }),
    deletedAt: State.SQLite.datetime({ nullable: true }),
    // TODO consider leaning more into Effect schema
    // other: Schema.Number.pipe(State.SQLite.asInteger),
  },
})

const todosWithIntId = State.SQLite.table({
  name: 'todos_with_int_id',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    status: State.SQLite.text({ schema: Schema.Literals(['active', 'completed']) }),
  },
})

const comments = State.SQLite.table({
  name: 'comments',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    todoId: State.SQLite.text({}),
  },
})

const UiState = State.SQLite.clientDocument({
  name: 'UiState',
  schema: Schema.Struct({
    filter: Schema.Literals(['all', 'active', 'completed']),
  }),
  default: { value: { filter: 'all' } },
})

const UiStateWithDefaultId = State.SQLite.clientDocument({
  name: 'UiState',
  schema: Schema.Struct({
    filter: Schema.Literals(['all', 'active', 'completed']),
  }),
  default: {
    id: 'static',
    value: { filter: 'all' },
  },
})

const issue = State.SQLite.table({
  name: 'issue',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    title: State.SQLite.text({ default: '' }),
    creator: State.SQLite.text({ default: '' }),
    priority: State.SQLite.integer({ schema: Schema.Literals([0, 1, 2, 3, 4]), default: 0 }),
    created: State.SQLite.integer({ schema: Schema.DateFromMillis }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromMillis }),
    modified: State.SQLite.integer({ schema: Schema.DateFromMillis }),
    kanbanorder: State.SQLite.text({ nullable: false, default: '' }),
  },
  indexes: [
    { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
    { name: 'issue_created', columns: ['created'] },
  ],
})

const selections = State.SQLite.table({
  name: 'selections',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    group: State.SQLite.text({}),
  },
})

const Source = Schema.Literals(['google', 'linkedin', 'facebook'])
const ProfileAttribute = Schema.Struct({ key: Schema.String, value: Schema.String })

const personProfiles = State.SQLite.table({
  name: 'person_profiles',
  columns: {
    personId: State.SQLite.text({ primaryKey: true }),
    sources: State.SQLite.json({ schema: Schema.Array(Source), default: [] }),
    tags: State.SQLite.json({ schema: Schema.Array(Schema.String), default: [] }),
    attributes: State.SQLite.json({ schema: Schema.Array(ProfileAttribute), default: [] }),
    /** Nullable JSON array column for testing JSON_CONTAINS on nullable columns */
    optionalTags: State.SQLite.json({ schema: Schema.Array(Schema.String), nullable: true }),
  },
})

const db = { todos, todosWithIntId, comments, issue, selections, UiState, UiStateWithDefaultId, personProfiles }

describe('query builder', () => {
  describe('basic queries', () => {
    it('should handle simple SELECT queries', () => {
      expect(db.todos.asSql()).toEqual({
        bindValues: [],
        query: "SELECT * FROM 'todos'",
        usedTables: new Set(['todos']),
      })

      expect(db.todos.select('id').asSql()).toEqual({
        bindValues: [],
        query: 'SELECT "id" FROM \'todos\'',
        usedTables: new Set(['todos']),
      })

      expect(db.todos.select('id', 'text').asSql()).toEqual({
        bindValues: [],
        query: 'SELECT "id", "text" FROM \'todos\'',
        usedTables: new Set(['todos']),
      })
    })

    it('derives result schemas for SELECT queries', async () => {
      const selectedRows = new TestSchema.Asserts(getResultSchema(db.todos.select('id', 'text')))
      await selectedRows.decoding().succeed([{ id: '123', text: 'Buy milk' }])

      const selectedColumn = new TestSchema.Asserts(getResultSchema(db.todos.select('id')))
      await selectedColumn.decoding().succeed([{ id: '123' }], ['123'])
    })

    it('should handle .first()', () => {
      expect(db.todos.select('id', 'text').first().asSql()).toEqual({
        bindValues: [1],
        query: 'SELECT "id", "text" FROM \'todos\' LIMIT ?',
        usedTables: new Set(['todos']),
      })

      expect(db.todos.select('id', 'text').first({ behaviour: 'error' }).asSql()).toEqual({
        bindValues: [1],
        query: 'SELECT "id", "text" FROM \'todos\' LIMIT ?',
        usedTables: new Set(['todos']),
      })

      expect(
        db.todos
          .select('id', 'text')
          .first({ behaviour: 'fallback', fallback: () => undefined })
          .asSql(),
      ).toEqual({
        bindValues: [1],
        query: 'SELECT "id", "text" FROM \'todos\' LIMIT ?',
        usedTables: new Set(['todos']),
      })
    })

    it('derives result schemas for .first()', async () => {
      const firstOrUndefined = new TestSchema.Asserts(getResultSchema(db.todos.select('id', 'text').first()))
      await firstOrUndefined.decoding().succeed([], undefined)
      await firstOrUndefined.decoding().succeed([{ id: '123', text: 'Buy milk' }], { id: '123', text: 'Buy milk' })

      const firstOrError = new TestSchema.Asserts(
        getResultSchema(db.todos.select('id', 'text').first({ behaviour: 'error' })),
      )
      await firstOrError.decoding().succeed([{ id: '123', text: 'Buy milk' }], { id: '123', text: 'Buy milk' })
      await firstOrError.decoding().fail([], 'Unable to retrieve the first element of an empty array')

      const firstOrFallback = new TestSchema.Asserts(
        getResultSchema(db.todos.select('id', 'text').first({ behaviour: 'fallback', fallback: () => undefined })),
      )
      await firstOrFallback.decoding().succeed([], undefined)
    })

    it('should handle WHERE clauses', () => {
      expect(db.todos.select('id', 'text').where('completed', true).asSql()).toEqual({
        bindValues: [1],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" = ?',
        usedTables: new Set(['todos']),
      })
      expect(db.todos.select('id', 'text').where('completed', '!=', true).asSql()).toEqual({
        bindValues: [1],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" != ?',
        usedTables: new Set(['todos']),
      })
      expect(db.todos.select('id', 'text').where({ completed: true }).asSql()).toEqual({
        bindValues: [1],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" = ?',
        usedTables: new Set(['todos']),
      })
      expect(db.todos.select('id', 'text').where({ completed: undefined }).asSql()).toEqual({
        bindValues: [],
        query: 'SELECT "id", "text" FROM \'todos\'',
        usedTables: new Set(['todos']),
      })
      expect(
        db.todos
          .select('id', 'text')
          .where({ deletedAt: { op: '<=', value: new Date('2024-01-01') } })
          .asSql(),
      ).toEqual({
        bindValues: ['2024-01-01T00:00:00.000Z'],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "deletedAt" <= ?',
        usedTables: new Set(['todos']),
      })
      expect(
        db.todos
          .select('id', 'text')
          .where({ status: { op: 'IN', value: ['active'] } })
          .asSql(),
      ).toEqual({
        bindValues: ['active'],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "status" IN (?)',
        usedTables: new Set(['todos']),
      })
      expect(
        db.todos
          .select('id', 'text')
          .where({ status: { op: 'NOT IN', value: ['active', 'completed'] } })
          .asSql(),
      ).toEqual({
        bindValues: ['active', 'completed'],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "status" NOT IN (?, ?)',
        usedTables: new Set(['todos']),
      })

      expect(
        db.todos
          .select('id', 'text')
          .where({ completed: false })
          .where({ status: { op: 'IN', value: ['active'] } })
          .where({ deletedAt: undefined })
          .asSql(),
      ).toEqual({
        bindValues: [0, 'active'],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" = ? AND "status" IN (?)',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle OFFSET and LIMIT clauses', () => {
      expect(db.todos.select('id', 'text').where('completed', true).offset(10).limit(10).asSql()).toEqual({
        bindValues: [1, 10, 10],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" = ? LIMIT ? OFFSET ?',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle OFFSET and LIMIT clauses correctly', () => {
      // Test with both offset and limit
      expect(db.todos.select('id', 'text').where('completed', true).offset(5).limit(10).asSql()).toEqual({
        bindValues: [1, 10, 5],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" = ? LIMIT ? OFFSET ?',
        usedTables: new Set(['todos']),
      })

      // Test with only offset
      expect(db.todos.select('id', 'text').where('completed', true).offset(5).asSql()).toEqual({
        bindValues: [1, 5],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" = ? OFFSET ?',
        usedTables: new Set(['todos']),
      })

      // Test with only limit
      expect(db.todos.select('id', 'text').where('completed', true).limit(10).asSql()).toEqual({
        bindValues: [1, 10],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "completed" = ? LIMIT ?',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle COUNT queries', () => {
      expect(db.todos.count().asSql()).toEqual({
        bindValues: [],
        query: "SELECT COUNT(*) as count FROM 'todos'",
        usedTables: new Set(['todos']),
      })
      expect(db.todos.count().where('completed', true).asSql()).toEqual({
        bindValues: [1],
        query: 'SELECT COUNT(*) as count FROM \'todos\' WHERE "completed" = ?',
        usedTables: new Set(['todos']),
      })
      expect(db.todos.where('completed', true).count().asSql()).toEqual({
        bindValues: [1],
        query: 'SELECT COUNT(*) as count FROM \'todos\' WHERE "completed" = ?',
        usedTables: new Set(['todos']),
      })
    })

    it('derives result schemas for COUNT queries', async () => {
      const countResult = new TestSchema.Asserts(getResultSchema(db.todos.count()))
      await countResult.decoding().succeed([{ count: 3 }], 3)
    })

    it('should handle NULL comparisons', () => {
      expect(db.todos.select('id', 'text').where('deletedAt', '=', null).asSql()).toEqual({
        bindValues: [],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "deletedAt" IS NULL',
        usedTables: new Set(['todos']),
      })
      expect(db.todos.select('id', 'text').where('deletedAt', '!=', null).asSql()).toEqual({
        bindValues: [],
        query: 'SELECT "id", "text" FROM \'todos\' WHERE "deletedAt" IS NOT NULL',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle orderBy', () => {
      expect(db.todos.orderBy('completed', 'desc').asSql()).toEqual({
        bindValues: [],
        query: 'SELECT * FROM \'todos\' ORDER BY "completed" desc',
        usedTables: new Set(['todos']),
      })

      expect(db.todos.orderBy([{ col: 'completed', direction: 'desc' }]).asSql()).toEqual({
        bindValues: [],
        query: 'SELECT * FROM \'todos\' ORDER BY "completed" desc',
        usedTables: new Set(['todos']),
      })

      expect(db.todos.orderBy([]).asSql()).toEqual({
        bindValues: [],
        query: "SELECT * FROM 'todos'",
        usedTables: new Set(['todos']),
      })
    })

    it('should handle JSON_CONTAINS operator for JSON array columns', () => {
      expect(db.personProfiles.where({ sources: { op: 'JSON_CONTAINS', value: 'google' } }).asSql()).toEqual({
        bindValues: ['google'],
        query: 'SELECT * FROM \'person_profiles\' WHERE EXISTS (SELECT 1 FROM json_each("sources") WHERE value = ?)',
        usedTables: new Set(['person_profiles']),
      })

      // With select
      expect(
        db.personProfiles
          .select('personId')
          .where({ sources: { op: 'JSON_CONTAINS', value: 'linkedin' } })
          .asSql(),
      ).toEqual({
        bindValues: ['linkedin'],
        query:
          'SELECT "personId" FROM \'person_profiles\' WHERE EXISTS (SELECT 1 FROM json_each("sources") WHERE value = ?)',
        usedTables: new Set(['person_profiles']),
      })

      // With plain string array column
      expect(db.personProfiles.where({ tags: { op: 'JSON_CONTAINS', value: 'important' } }).asSql()).toEqual({
        bindValues: ['important'],
        query: 'SELECT * FROM \'person_profiles\' WHERE EXISTS (SELECT 1 FROM json_each("tags") WHERE value = ?)',
        usedTables: new Set(['person_profiles']),
      })
    })

    it('should handle JSON_NOT_CONTAINS operator for JSON array columns', () => {
      expect(db.personProfiles.where({ sources: { op: 'JSON_NOT_CONTAINS', value: 'google' } }).asSql()).toEqual({
        bindValues: ['google'],
        query:
          'SELECT * FROM \'person_profiles\' WHERE NOT EXISTS (SELECT 1 FROM json_each("sources") WHERE value = ?)',
        usedTables: new Set(['person_profiles']),
      })
    })

    it('should JSON-stringify object elements for JSON_CONTAINS', () => {
      expect(
        db.personProfiles
          .where({
            attributes: { op: 'JSON_CONTAINS', value: { key: 'language', value: 'typescript' } },
          })
          .asSql(),
      ).toEqual({
        bindValues: ['{"key":"language","value":"typescript"}'],
        query: 'SELECT * FROM \'person_profiles\' WHERE EXISTS (SELECT 1 FROM json_each("attributes") WHERE value = ?)',
        usedTables: new Set(['person_profiles']),
      })
    })

    it('should handle combining JSON_CONTAINS with other WHERE clauses', () => {
      expect(
        db.personProfiles
          .where({ sources: { op: 'JSON_CONTAINS', value: 'google' } })
          .where({ sources: { op: 'JSON_NOT_CONTAINS', value: 'facebook' } })
          .asSql(),
      ).toEqual({
        bindValues: ['google', 'facebook'],
        query:
          'SELECT * FROM \'person_profiles\' WHERE EXISTS (SELECT 1 FROM json_each("sources") WHERE value = ?) AND NOT EXISTS (SELECT 1 FROM json_each("sources") WHERE value = ?)',
        usedTables: new Set(['person_profiles']),
      })
    })

    it('should handle JSON_CONTAINS on nullable JSON array columns', () => {
      expect(db.personProfiles.where({ optionalTags: { op: 'JSON_CONTAINS', value: 'important' } }).asSql()).toEqual({
        bindValues: ['important'],
        query:
          'SELECT * FROM \'person_profiles\' WHERE EXISTS (SELECT 1 FROM json_each("optionalTags") WHERE value = ?)',
        usedTables: new Set(['person_profiles']),
      })

      // With JSON_NOT_CONTAINS
      expect(db.personProfiles.where({ optionalTags: { op: 'JSON_NOT_CONTAINS', value: 'archived' } }).asSql()).toEqual(
        {
          bindValues: ['archived'],
          query:
            'SELECT * FROM \'person_profiles\' WHERE NOT EXISTS (SELECT 1 FROM json_each("optionalTags") WHERE value = ?)',
          usedTables: new Set(['person_profiles']),
        },
      )
    })

    it('should throw error when using JSON_CONTAINS on non-JSON array column', () => {
      expect(() =>
        // Type system prevents this at compile time for non-array columns, but test runtime check
        db.todos.where({ status: { op: 'JSON_CONTAINS', value: 'active' } } as any).asSql(),
      ).toThrow('JSON_CONTAINS operator can only be used on JSON array columns')
    })
  })

  describe('write operations', () => {
    it('should handle INSERT queries', () => {
      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).asSql()).toEqual({
        bindValues: ['123', 'Buy milk', 'active'],
        query: `INSERT INTO 'todos' ("id", "text", "status") VALUES (?, ?, ?)`,
        usedTables: new Set(['todos']),
      })
    })

    it('derives result schemas for write queries', async () => {
      const insertResult = new TestSchema.Asserts(
        getResultSchema(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' })),
      )
      await insertResult.decoding().succeed(1)
    })

    it('should handle INSERT queries with undefined values', () => {
      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).asSql()).toEqual({
        bindValues: ['123', 'Buy milk', 'active'],
        query: 'INSERT INTO \'todos\' ("id", "text", "status") VALUES (?, ?, ?)',
        usedTables: new Set(['todos']),
      })
    })

    // Test helped to catch a bindValues ordering bug
    it('should handle INSERT queries (issue)', () => {
      expect(
        db.issue
          .insert({
            id: 1,
            title: 'Revert the user profile page',
            priority: 2,
            created: new Date('2024-08-01T17:15:20.507Z'),
            modified: new Date('2024-12-29T17:15:20.507Z'),
            kanbanorder: 'a2',
            creator: 'John Doe',
          })
          .asSql(),
      ).toEqual({
        bindValues: [1, 'Revert the user profile page', 2, 1722532520507, 1735492520507, 'a2', 'John Doe'],
        query:
          'INSERT INTO \'issue\' ("id", "title", "priority", "created", "modified", "kanbanorder", "creator") VALUES (?, ?, ?, ?, ?, ?, ?)',
        usedTables: new Set(['issue']),
      })
    })

    it('should handle UPDATE queries', () => {
      expect(db.todos.update({ status: 'completed' }).where({ id: '123' }).asSql()).toEqual({
        bindValues: ['completed', '123'],
        query: 'UPDATE \'todos\' SET "status" = ? WHERE "id" = ?',
        usedTables: new Set(['todos']),
      })

      // empty update set
      expect(db.todos.update({}).where({ id: '123' }).asSql()).toEqual({
        bindValues: [],
        query: 'SELECT 1',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle UPDATE queries with undefined values', () => {
      expect(db.todos.update({ text: 'some text' }).where({ id: '123' }).asSql()).toEqual({
        bindValues: ['some text', '123'],
        query: 'UPDATE \'todos\' SET "text" = ? WHERE "id" = ?',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle UPDATE queries with undefined values (issue)', () => {
      expect(db.issue.update({ priority: 2, creator: 'John Doe' }).where({ id: 1 }).asSql()).toEqual({
        bindValues: [2, 'John Doe', 1],
        query: 'UPDATE \'issue\' SET "priority" = ?, "creator" = ? WHERE "id" = ?',
        usedTables: new Set(['issue']),
      })
    })

    it('should handle DELETE queries', () => {
      expect(db.todos.delete().where({ status: 'completed' }).asSql()).toEqual({
        bindValues: ['completed'],
        query: 'DELETE FROM \'todos\' WHERE "status" = ?',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle INSERT with ON CONFLICT', () => {
      expect(
        db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'ignore').asSql(),
      ).toEqual({
        bindValues: ['123', 'Buy milk', 'active'],
        query: 'INSERT INTO \'todos\' ("id", "text", "status") VALUES (?, ?, ?) ON CONFLICT ("id") DO NOTHING',
        usedTables: new Set(['todos']),
      })

      expect(
        db.todos
          .insert({ id: '123', text: 'Buy milk', status: 'active' })
          .onConflict('id', 'update', { text: 'Buy soy milk', status: 'active' })
          .asSql(),
      ).toEqual({
        bindValues: ['123', 'Buy milk', 'active', 'Buy soy milk', 'active'],
        query:
          'INSERT INTO \'todos\' ("id", "text", "status") VALUES (?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "text" = ?, "status" = ?',
        usedTables: new Set(['todos']),
      })

      expect(
        db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'replace').asSql(),
      ).toEqual({
        bindValues: ['123', 'Buy milk', 'active'],
        query: 'INSERT OR REPLACE INTO \'todos\' ("id", "text", "status") VALUES (?, ?, ?)',
        usedTables: new Set(['todos']),
      })
    })

    it('should quote reserved column names', () => {
      expect(db.selections.insert({ id: 1, group: 'alpha' }).onConflict('id', 'ignore').asSql()).toEqual({
        bindValues: [1, 'alpha'],
        query: 'INSERT INTO \'selections\' ("id", "group") VALUES (?, ?) ON CONFLICT ("id") DO NOTHING',
        usedTables: new Set(['selections']),
      })

      expect(db.selections.update({ group: 'beta' }).where({ id: 1 }).asSql()).toEqual({
        bindValues: ['beta', 1],
        query: 'UPDATE \'selections\' SET "group" = ? WHERE "id" = ?',
        usedTables: new Set(['selections']),
      })
    })

    it('should handle ON CONFLICT with multiple columns', () => {
      expect(
        db.todos
          .insert({ id: '123', text: 'Buy milk', status: 'active' })
          .onConflict(['id', 'status'], 'ignore')
          .asSql(),
      ).toEqual({
        bindValues: ['123', 'Buy milk', 'active'],
        query:
          'INSERT INTO \'todos\' ("id", "text", "status") VALUES (?, ?, ?) ON CONFLICT ("id", "status") DO NOTHING',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle RETURNING clause', () => {
      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).returning('id').asSql()).toEqual({
        bindValues: ['123', 'Buy milk', 'active'],
        query: 'INSERT INTO \'todos\' ("id", "text", "status") VALUES (?, ?, ?) RETURNING "id"',
        usedTables: new Set(['todos']),
      })

      expect(db.todos.update({ status: 'completed' }).where({ id: '123' }).returning('id').asSql()).toEqual({
        bindValues: ['completed', '123'],
        query: 'UPDATE \'todos\' SET "status" = ? WHERE "id" = ? RETURNING "id"',
        usedTables: new Set(['todos']),
      })

      expect(db.todos.delete().where({ status: 'completed' }).returning('id').asSql()).toEqual({
        bindValues: ['completed'],
        query: 'DELETE FROM \'todos\' WHERE "status" = ? RETURNING "id"',
        usedTables: new Set(['todos']),
      })
    })

    it('derives result schemas for RETURNING clauses', async () => {
      const returningId = new TestSchema.Asserts(
        getResultSchema(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).returning('id')),
      )
      await returningId.decoding().succeed([{ id: '123' }])
    })

    it('should handle where().delete() - preserving where clauses', () => {
      expect(db.todos.where({ status: 'completed' }).delete().asSql()).toEqual({
        bindValues: ['completed'],
        query: 'DELETE FROM \'todos\' WHERE "status" = ?',
        usedTables: new Set(['todos']),
      })

      // Multiple where clauses
      expect(db.todos.where({ status: 'completed' }).where({ deletedAt: null }).delete().asSql()).toEqual({
        bindValues: ['completed'],
        query: 'DELETE FROM \'todos\' WHERE "status" = ? AND "deletedAt" IS NULL',
        usedTables: new Set(['todos']),
      })
    })

    it('should handle where().update() - preserving where clauses', () => {
      expect(db.todos.where({ id: '123' }).update({ status: 'completed' }).asSql()).toEqual({
        bindValues: ['completed', '123'],
        query: 'UPDATE \'todos\' SET "status" = ? WHERE "id" = ?',
        usedTables: new Set(['todos']),
      })

      // Multiple where clauses
      expect(db.todos.where({ id: '123' }).where({ deletedAt: null }).update({ status: 'completed' }).asSql()).toEqual({
        bindValues: ['completed', '123'],
        query: 'UPDATE \'todos\' SET "status" = ? WHERE "id" = ? AND "deletedAt" IS NULL',
        usedTables: new Set(['todos']),
      })
    })

    it('should have equivalent behavior for both delete patterns', () => {
      const pattern1 = db.todos.where({ status: 'completed', id: '123' }).delete().asSql()
      const pattern2 = db.todos.delete().where({ status: 'completed', id: '123' }).asSql()

      expect(pattern1).toEqual(pattern2)
    })

    it('should have equivalent behavior for both update patterns', () => {
      const pattern1 = db.todos.where({ id: '123' }).update({ status: 'completed', text: 'Updated' }).asSql()
      const pattern2 = db.todos.update({ status: 'completed', text: 'Updated' }).where({ id: '123' }).asSql()

      expect(pattern1).toEqual(pattern2)
    })
  })

  describe('schema transforms', () => {
    const Flat = Schema.Struct({
      id: Schema.String.pipe(State.SQLite.withPrimaryKey),
      contactFirstName: Schema.String,
      contactLastName: Schema.String,
      contactEmail: Schema.String.pipe(State.SQLite.withUnique),
    })

    const Nested = Flat.pipe(
      Schema.decodeTo(
        Schema.Struct({
          id: Schema.String,
          contact: Schema.Struct({
            firstName: Schema.String,
            lastName: Schema.String,
            email: Schema.String,
          }),
        }),
        SchemaTransformation.transform({
          decode: ({ id, contactFirstName, contactLastName, contactEmail }) => ({
            id,
            contact: {
              firstName: contactFirstName,
              lastName: contactLastName,
              email: contactEmail,
            },
          }),
          encode: ({ id, contact }) => ({
            id,
            contactFirstName: contact.firstName,
            contactLastName: contact.lastName,
            contactEmail: contact.email,
          }),
        }),
      ),
    )

    const makeContactsTable = () =>
      State.SQLite.table({
        name: 'contacts',
        schema: Nested,
        // schema: Flat,
      })

    it('exposes flattened insert type while schema type is nested', () => {
      const contactsTable = makeContactsTable()

      type InsertInput = Parameters<(typeof contactsTable)['insert']>[0]
      type NestedType = (typeof Nested)['Type']

      type Assert<T extends true> = T

      type InsertKeys = keyof InsertInput
      type NestedKeys = keyof NestedType

      type _InsertHasFlattenedColumns = Assert<
        'contactFirstName' extends InsertKeys
          ? 'contactLastName' extends InsertKeys
            ? 'contactEmail' extends InsertKeys
              ? true
              : false
            : false
          : false
      >

      type _InsertDoesNotExposeNested = Assert<Extract<'contact', InsertKeys> extends never ? true : false>

      type _SchemaTypeIsNested = Assert<'contact' extends NestedKeys ? true : false>

      void contactsTable
    })

    it('encodes flat insert values for transformed schemas', () => {
      const contactsTable = makeContactsTable()

      expect(
        contactsTable
          // TODO in the future we should use decoded types here instead of encoded
          .insert({
            id: 'person-1',
            contactFirstName: 'Ada',
            contactLastName: 'Lovelace',
            contactEmail: 'ada@example.com',
          })
          .asSql(),
      ).toEqual({
        bindValues: ['person-1', 'Ada', 'Lovelace', 'ada@example.com'],
        query:
          'INSERT INTO \'contacts\' ("id", "contactFirstName", "contactLastName", "contactEmail") VALUES (?, ?, ?, ?)',
        usedTables: new Set(['contacts']),
      })
    })

    it('rejects nested insert values because flat columns are required', () => {
      const contactsTable = makeContactsTable()

      expect(() =>
        contactsTable
          .insert({
            id: 'person-1',
            // @ts-expect-error
            contact: {
              firstName: 'Ada',
              lastName: 'Lovelace',
              email: 'ada@example.com',
            },
          })
          .asSql(),
      ).toThrowError(/contactFirstName/)
    })
  })
})

// TODO nested queries
// const rawSql = <A, I>(sql: string, params: { [key: string]: any }, schema: Schema.Codec<A, I>) =>
//   ({
//     sql,
//     params,
//     schema,
//   }) as any as QueryBuilder<A, any>

// Translates to
// SELECT todos.*, (SELECT COUNT(*) FROM comments WHERE comments.todoId = todos.id) AS commentsCount
// FROM todos WHERE todos.completed = true
// const q4CommentsCountSchema = Schema.Struct({ count: Schema.Number }).pipe(
//   Schema.pluck('count'),
//   Schema.Array,
//   Schema.headOrElse(),
// )
// const _q4$ = db.todos
//   .select({
//     commentsCount: (ref) =>
//       rawSql(
//         sql`SELECT COUNT(*) as count FROM comments WHERE comments.todoId = $todoId`,
//         { todoId: ref },
//         q4CommentsCountSchema,
//       ),
//   })
//   .where({ completed: true })

// const _q5$ = db.todos
//   .select({ commentsCount: (todoId: TODO) => comments.query.where({ todoId }).count() })
//   .where({ completed: true })
