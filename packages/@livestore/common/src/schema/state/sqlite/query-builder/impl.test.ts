import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

import { State } from '../../../mod.ts'
import type { QueryBuilder } from './api.ts'
import { getResultSchema } from './impl.ts'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    status: State.SQLite.text({ schema: Schema.Literal('active', 'completed') }),
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
    status: State.SQLite.text({ schema: Schema.Literal('active', 'completed') }),
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
    filter: Schema.Literal('all', 'active', 'completed'),
  }),
  default: { value: { filter: 'all' } },
})

const UiStateWithDefaultId = State.SQLite.clientDocument({
  name: 'UiState',
  schema: Schema.Struct({
    filter: Schema.Literal('all', 'active', 'completed'),
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
    priority: State.SQLite.integer({ schema: Schema.Literal(0, 1, 2, 3, 4), default: 0 }),
    created: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    modified: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    kanbanorder: State.SQLite.text({ nullable: false, default: '' }),
  },
  indexes: [
    { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
    { name: 'issue_created', columns: ['created'] },
  ],
})

const db = { todos, todosWithIntId, comments, issue, UiState, UiStateWithDefaultId }

const dump = (qb: QueryBuilder<any, any, any>) => ({
  bindValues: qb.asSql().bindValues,
  query: qb.asSql().query,
  schema: getResultSchema(qb).toString(),
})

describe('query builder', () => {
  describe('basic queries', () => {
    it('should handle simple SELECT queries', () => {
      expect(dump(db.todos)).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos'",
          "schema": "ReadonlyArray<todos>",
        }
      `)

      expect(dump(db.todos.select('id'))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id FROM 'todos'",
          "schema": "ReadonlyArray<({ readonly id: string } <-> string)>",
        }
      `)

      expect(dump(db.todos.select('id', 'text'))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos'",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
    })

    it('should handle .first()', () => {
      expect(dump(db.todos.select('id', 'text').first())).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' LIMIT ?",
          "schema": "(ReadonlyArray<{ readonly id: string; readonly text: string } | undefined> <-> { readonly id: string; readonly text: string } | undefined)",
        }
      `)

      expect(dump(db.todos.select('id', 'text').first({ behaviour: 'error' }))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' LIMIT ?",
          "schema": "(ReadonlyArray<{ readonly id: string; readonly text: string }> <-> { readonly id: string; readonly text: string })",
        }
      `)

      expect(
        dump(db.todos.select('id', 'text').first({ behaviour: 'fallback', fallback: () => undefined })),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' LIMIT ?",
          "schema": "(ReadonlyArray<{ readonly id: string; readonly text: string }> | readonly [undefined] <-> { readonly id: string; readonly text: string } | undefined)",
        }
      `)
    })

    it('should handle WHERE clauses', () => {
      expect(dump(db.todos.select('id', 'text').where('completed', true))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ?",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
      expect(dump(db.todos.select('id', 'text').where('completed', '!=', true))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed != ?",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
      expect(dump(db.todos.select('id', 'text').where({ completed: true }))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ?",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
      expect(dump(db.todos.select('id', 'text').where({ completed: undefined }))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos'",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
      expect(
        dump(db.todos.select('id', 'text').where({ deletedAt: { op: '<=', value: new Date('2024-01-01') } })),
      ).toMatchInlineSnapshot(`
          {
            "bindValues": [
              "2024-01-01T00:00:00.000Z",
            ],
            "query": "SELECT id, text FROM 'todos' WHERE deletedAt <= ?",
            "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
          }
        `)
      expect(
        dump(db.todos.select('id', 'text').where({ status: { op: 'IN', value: ['active'] } })),
      ).toMatchInlineSnapshot(`
          {
            "bindValues": [
              "active",
            ],
            "query": "SELECT id, text FROM 'todos' WHERE status IN (?)",
            "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
          }
        `)
      expect(
        dump(db.todos.select('id', 'text').where({ status: { op: 'NOT IN', value: ['active', 'completed'] } })),
      ).toMatchInlineSnapshot(`
          {
            "bindValues": [
              "active",
              "completed",
            ],
            "query": "SELECT id, text FROM 'todos' WHERE status NOT IN (?, ?)",
            "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
          }
        `)

      expect(
        dump(
          db.todos
            .select('id', 'text')
            .where({ completed: false })
            .where({ status: { op: 'IN', value: ['active'] } })
            .where({ deletedAt: undefined }),
        ),
      ).toMatchInlineSnapshot(`
          {
            "bindValues": [
              0,
              "active",
            ],
            "query": "SELECT id, text FROM 'todos' WHERE completed = ? AND status IN (?)",
            "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
          }
        `)
    })

    it('should handle OFFSET and LIMIT clauses', () => {
      expect(dump(db.todos.select('id', 'text').where('completed', true).offset(10).limit(10))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
            10,
            10,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ? OFFSET ? LIMIT ?",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
    })

    it('should handle OFFSET and LIMIT clauses correctly', () => {
      // Test with both offset and limit
      expect(dump(db.todos.select('id', 'text').where('completed', true).offset(5).limit(10))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
            5,
            10,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ? OFFSET ? LIMIT ?",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)

      // Test with only offset
      expect(dump(db.todos.select('id', 'text').where('completed', true).offset(5))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
            5,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ? OFFSET ?",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)

      // Test with only limit
      expect(dump(db.todos.select('id', 'text').where('completed', true).limit(10))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
            10,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ? LIMIT ?",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
    })

    it('should handle COUNT queries', () => {
      expect(dump(db.todos.count())).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT COUNT(*) as count FROM 'todos'",
          "schema": "(ReadonlyArray<({ readonly count: number } <-> number)> <-> number)",
        }
      `)
      expect(dump(db.todos.count().where('completed', true))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT COUNT(*) as count FROM 'todos' WHERE completed = ?",
          "schema": "(ReadonlyArray<({ readonly count: number } <-> number)> <-> number)",
        }
      `)
      expect(dump(db.todos.where('completed', true).count())).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT COUNT(*) as count FROM 'todos' WHERE completed = ?",
          "schema": "(ReadonlyArray<({ readonly count: number } <-> number)> <-> number)",
        }
      `)
    })

    it('should handle NULL comparisons', () => {
      expect(dump(db.todos.select('id', 'text').where('deletedAt', '=', null))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos' WHERE deletedAt IS NULL",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
      expect(dump(db.todos.select('id', 'text').where('deletedAt', '!=', null))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos' WHERE deletedAt IS NOT NULL",
          "schema": "ReadonlyArray<{ readonly id: string; readonly text: string }>",
        }
      `)
    })

    it('should handle orderBy', () => {
      expect(dump(db.todos.orderBy('completed', 'desc'))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos' ORDER BY completed desc",
          "schema": "ReadonlyArray<todos>",
        }
      `)

      expect(dump(db.todos.orderBy([{ col: 'completed', direction: 'desc' }]))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos' ORDER BY completed desc",
          "schema": "ReadonlyArray<todos>",
        }
      `)

      expect(dump(db.todos.orderBy([]))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos'",
          "schema": "ReadonlyArray<todos>",
        }
      `)
    })
  })

  // describe('getOrCreate queries', () => {
  //   it('should handle getOrCreate queries', () => {
  //     expect(dump(db.UiState.getOrCreate('sessionid-1'))).toMatchInlineSnapshot(`
  //         {
  //           "bindValues": [
  //             "sessionid-1",
  //           ],
  //           "query": "SELECT * FROM 'UiState' WHERE id = ?",
  //           "schema": "...", // TODO determine schema
  //         }
  //       `)
  //   })

  //   it('should handle getOrCreate queries with default id', () => {
  //     expect(dump(db.UiStateWithDefaultId.getOrCreate())).toMatchInlineSnapshot(`
  //       {
  //         "bindValues": [],
  //         "query": "SELECT * FROM 'UiState' WHERE id = ?",
  //         "schema": "...", // TODO determine schema
  //       }
  //     `)
  //   })
  //   // it('should handle row queries with numbers', () => {
  //   //   expect(dump(db.todosWithIntId.getOrCreate(123, { insertValues: { status: 'active' } }))).toMatchInlineSnapshot(`
  //   //     {
  //   //       "bindValues": [
  //   //         123,
  //   //       ],
  //   //       "query": "SELECT * FROM 'todos_with_int_id' WHERE id = ?",
  //   //       "schema": "...", // TODO determine schema
  //   //     }
  //   //   `)
  //   // })
  // })

  describe('write operations', () => {
    it('should handle INSERT queries', () => {
      expect(dump(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?)",
          "schema": "number",
        }
      `)
    })

    it('should handle INSERT queries with undefined values', () => {
      expect(
        dump(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' })),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?)",
          "schema": "number",
        }
      `)
    })

    // Test helped to catch a bindValues ordering bug
    it('should handle INSERT queries (issue)', () => {
      expect(
        dump(
          db.issue.insert({
            id: 1,
            title: 'Revert the user profile page',
            priority: 2,
            created: new Date('2024-08-01T17:15:20.507Z'),
            modified: new Date('2024-12-29T17:15:20.507Z'),
            kanbanorder: 'a2',
            creator: 'John Doe',
          }),
        ),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
            "Revert the user profile page",
            2,
            1722532520507,
            1735492520507,
            "a2",
            "John Doe",
          ],
          "query": "INSERT INTO 'issue' (id, title, priority, created, modified, kanbanorder, creator) VALUES (?, ?, ?, ?, ?, ?, ?)",
          "schema": "number",
        }
      `)
    })

    it('should handle UPDATE queries', () => {
      expect(dump(db.todos.update({ status: 'completed' }).where({ id: '123' }))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
            "123",
          ],
          "query": "UPDATE 'todos' SET status = ? WHERE id = ?",
          "schema": "number",
        }
      `)

      // empty update set
      expect(dump(db.todos.update({}).where({ id: '123' }))).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT 1",
          "schema": "number",
        }
      `)
    })

    it('should handle UPDATE queries with undefined values', () => {
      expect(
        dump(db.todos.update({ text: 'some text' }).where({ id: '123' })),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "some text",
            "123",
          ],
          "query": "UPDATE 'todos' SET text = ? WHERE id = ?",
          "schema": "number",
        }
      `)
    })

    it('should handle UPDATE queries with undefined values (issue)', () => {
      expect(dump(db.issue.update({ priority: 2, creator: 'John Doe' }).where({ id: 1 }))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            2,
            "John Doe",
            1,
          ],
          "query": "UPDATE 'issue' SET priority = ?, creator = ? WHERE id = ?",
          "schema": "number",
        }
      `)
    })

    it('should handle DELETE queries', () => {
      expect(dump(db.todos.delete().where({ status: 'completed' }))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
          ],
          "query": "DELETE FROM 'todos' WHERE status = ?",
          "schema": "number",
        }
      `)
    })

    it('should handle INSERT with ON CONFLICT', () => {
      expect(
        dump(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'ignore')),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
          "schema": "number",
        }
      `)

      expect(
        dump(
          db.todos
            .insert({ id: '123', text: 'Buy milk', status: 'active' })
            .onConflict('id', 'update', { text: 'Buy soy milk', status: 'active' }),
        ),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
            "Buy soy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET text = ?, status = ?",
          "schema": "number",
        }
      `)

      expect(
        dump(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'replace')),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT OR REPLACE INTO 'todos' (id, text, status) VALUES (?, ?, ?)",
          "schema": "number",
        }
      `)
    })

    it('should handle ON CONFLICT with multiple columns', () => {
      expect(
        dump(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict(['id', 'status'], 'ignore')),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?) ON CONFLICT (id, status) DO NOTHING",
          "schema": "number",
        }
      `)
    })

    it('should handle RETURNING clause', () => {
      expect(
        dump(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).returning('id')),
      ).toMatchInlineSnapshot(`
          {
            "bindValues": [
              "123",
              "Buy milk",
              "active",
            ],
            "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?) RETURNING id",
            "schema": "ReadonlyArray<{ readonly id: string }>",
          }
        `)

      expect(
        dump(db.todos.update({ status: 'completed' }).where({ id: '123' }).returning('id')),
      ).toMatchInlineSnapshot(`
          {
            "bindValues": [
              "completed",
              "123",
            ],
            "query": "UPDATE 'todos' SET status = ? WHERE id = ? RETURNING id",
            "schema": "ReadonlyArray<{ readonly id: string }>",
          }
        `)

      expect(dump(db.todos.delete().where({ status: 'completed' }).returning('id'))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
          ],
          "query": "DELETE FROM 'todos' WHERE status = ? RETURNING id",
          "schema": "ReadonlyArray<{ readonly id: string }>",
        }
      `)
    })

    it('should handle where().delete() - preserving where clauses', () => {
      expect(dump(db.todos.where({ status: 'completed' }).delete())).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
          ],
          "query": "DELETE FROM 'todos' WHERE status = ?",
          "schema": "number",
        }
      `)

      // Multiple where clauses
      expect(dump(db.todos.where({ status: 'completed' }).where({ deletedAt: null }).delete())).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
          ],
          "query": "DELETE FROM 'todos' WHERE status = ? AND deletedAt IS NULL",
          "schema": "number",
        }
      `)
    })

    it('should handle where().update() - preserving where clauses', () => {
      expect(dump(db.todos.where({ id: '123' }).update({ status: 'completed' }))).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
            "123",
          ],
          "query": "UPDATE 'todos' SET status = ? WHERE id = ?",
          "schema": "number",
        }
      `)

      // Multiple where clauses
      expect(
        dump(db.todos.where({ id: '123' }).where({ deletedAt: null }).update({ status: 'completed' })),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
            "123",
          ],
          "query": "UPDATE 'todos' SET status = ? WHERE id = ? AND deletedAt IS NULL",
          "schema": "number",
        }
      `)
    })

    it('should have equivalent behavior for both delete patterns', () => {
      const pattern1 = dump(db.todos.where({ status: 'completed', id: '123' }).delete())
      const pattern2 = dump(db.todos.delete().where({ status: 'completed', id: '123' }))

      expect(pattern1).toEqual(pattern2)
    })

    it('should have equivalent behavior for both update patterns', () => {
      const pattern1 = dump(db.todos.where({ id: '123' }).update({ status: 'completed', text: 'Updated' }))
      const pattern2 = dump(db.todos.update({ status: 'completed', text: 'Updated' }).where({ id: '123' }))

      expect(pattern1).toEqual(pattern2)
    })
  })
})

// TODO nested queries
// const rawSql = <A, I>(sql: string, params: { [key: string]: any }, schema: Schema.Schema<A, I>) =>
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
