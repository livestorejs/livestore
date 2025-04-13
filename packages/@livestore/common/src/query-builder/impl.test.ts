import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

import { State } from '../schema/mod.js'
import { getResultSchema } from './impl.js'

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

export const issue = State.SQLite.table({
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

describe('query builder', () => {
  describe('result schema', () => {
    it('should print the schema', () => {
      expect(String(getResultSchema(db.todos))).toMatchInlineSnapshot(`"ReadonlyArray<todos>"`)
    })
  })

  describe('basic queries', () => {
    it('should handle simple SELECT queries', () => {
      expect(db.todos.asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos'",
        }
      `)

      expect(db.todos.select('id').asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id FROM 'todos'",
        }
      `)

      expect(db.todos.select('id', 'text').asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos'",
        }
      `)
    })

    it('should handle WHERE clauses', () => {
      expect(db.todos.select('id', 'text').where('completed', true).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ?",
        }
      `)
      expect(db.todos.select('id', 'text').where('completed', '!=', true).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed != ?",
        }
      `)
      expect(db.todos.select('id', 'text').where({ completed: true }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT id, text FROM 'todos' WHERE completed = ?",
        }
      `)
      expect(db.todos.select('id', 'text').where({ completed: undefined }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos'",
        }
      `)
      expect(
        db.todos
          .select('id', 'text')
          .where({ deletedAt: { op: '<=', value: new Date('2024-01-01') } })
          .asSql(),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "2024-01-01T00:00:00.000Z",
          ],
          "query": "SELECT id, text FROM 'todos' WHERE deletedAt <= ?",
        }
      `)
      expect(
        db.todos
          .select('id', 'text')
          .where({ status: { op: 'IN', value: ['active'] } })
          .asSql(),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "active",
          ],
          "query": "SELECT id, text FROM 'todos' WHERE status IN (?)",
        }
      `)
      expect(
        db.todos
          .select('id', 'text')
          .where({ status: { op: 'NOT IN', value: ['active', 'completed'] } })
          .asSql(),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "active",
            "completed",
          ],
          "query": "SELECT id, text FROM 'todos' WHERE status NOT IN (?, ?)",
        }
      `)
    })

    it('should handle OFFSET and LIMIT clauses', () => {
      expect(db.todos.select('id', 'text').where('completed', true).offset(10).limit(10).asSql())
        .toMatchInlineSnapshot(`
          {
            "bindValues": [
              1,
              10,
              10,
            ],
            "query": "SELECT id, text FROM 'todos' WHERE completed = ? OFFSET ? LIMIT ?",
          }
        `)
    })

    it('should handle OFFSET and LIMIT clauses correctly', () => {
      // Test with both offset and limit
      expect(db.todos.select('id', 'text').where('completed', true).offset(5).limit(10).asSql()).toMatchInlineSnapshot(`
          {
            "bindValues": [
              1,
              5,
              10,
            ],
            "query": "SELECT id, text FROM 'todos' WHERE completed = ? OFFSET ? LIMIT ?",
          }
        `)

      // Test with only offset
      expect(db.todos.select('id', 'text').where('completed', true).offset(5).asSql()).toMatchInlineSnapshot(`
          {
            "bindValues": [
              1,
              5,
            ],
            "query": "SELECT id, text FROM 'todos' WHERE completed = ? OFFSET ?",
          }
        `)

      // Test with only limit
      expect(db.todos.select('id', 'text').where('completed', true).limit(10).asSql()).toMatchInlineSnapshot(`
          {
            "bindValues": [
              1,
              10,
            ],
            "query": "SELECT id, text FROM 'todos' WHERE completed = ? LIMIT ?",
          }
        `)
    })

    it('should handle COUNT queries', () => {
      expect(db.todos.count().asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT COUNT(*) as count FROM 'todos'",
        }
      `)
      expect(db.todos.count().where('completed', true).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            1,
          ],
          "query": "SELECT COUNT(*) as count FROM 'todos' WHERE completed = ?",
        }
      `)
    })

    it('should handle NULL comparisons', () => {
      expect(db.todos.select('id', 'text').where('deletedAt', '=', null).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos' WHERE deletedAt IS NULL",
        }
      `)
      expect(db.todos.select('id', 'text').where('deletedAt', '!=', null).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT id, text FROM 'todos' WHERE deletedAt IS NOT NULL",
        }
      `)
    })

    it('should handle orderBy', () => {
      expect(db.todos.orderBy('completed', 'desc').asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos' ORDER BY completed desc",
        }
      `)

      expect(db.todos.orderBy([{ col: 'completed', direction: 'desc' }]).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos' ORDER BY completed desc",
        }
      `)

      expect(db.todos.orderBy([]).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT * FROM 'todos'",
        }
      `)
    })
  })

  // describe('getOrCreate queries', () => {
  //   it('should handle getOrCreate queries', () => {
  //     expect(db.UiState.getOrCreate('sessionid-1').asSql()).toMatchInlineSnapshot(`
  //         {
  //           "bindValues": [
  //             "sessionid-1",
  //           ],
  //           "query": "SELECT * FROM 'UiState' WHERE id = ?",
  //         }
  //       `)
  //   })

  //   it('should handle getOrCreate queries with default id', () => {
  //     expect(db.UiStateWithDefaultId.getOrCreate().asSql()).toMatchInlineSnapshot(`
  //       {
  //         "bindValues": [],
  //         "query": "SELECT * FROM 'UiState' WHERE id = ?",
  //       }
  //     `)
  //   })
  //   // it('should handle row queries with numbers', () => {
  //   //   expect(db.todosWithIntId.getOrCreate(123, { insertValues: { status: 'active' } }).asSql()).toMatchInlineSnapshot(`
  //   //     {
  //   //       "bindValues": [
  //   //         123,
  //   //       ],
  //   //       "query": "SELECT * FROM 'todos_with_int_id' WHERE id = ?",
  //   //     }
  //   //   `)
  //   // })
  // })

  describe('write operations', () => {
    it('should handle INSERT queries', () => {
      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?)",
        }
      `)
    })

    it('should handle INSERT queries with undefined values', () => {
      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active', completed: undefined }).asSql())
        .toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?)",
        }
      `)
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
        }
      `)
    })

    it('should handle UPDATE queries', () => {
      expect(db.todos.update({ status: 'completed' }).where({ id: '123' }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
            "123",
          ],
          "query": "UPDATE 'todos' SET status = ? WHERE id = ?",
        }
      `)

      // empty update set
      expect(db.todos.update({}).where({ id: '123' }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [],
          "query": "SELECT 1",
        }
      `)
    })

    it('should handle UPDATE queries with undefined values', () => {
      expect(db.todos.update({ status: undefined, text: 'some text' }).where({ id: '123' }).asSql())
        .toMatchInlineSnapshot(`
        {
          "bindValues": [
            "some text",
            "123",
          ],
          "query": "UPDATE 'todos' SET text = ? WHERE id = ?",
        }
      `)
    })

    it('should handle UPDATE queries with undefined values (issue)', () => {
      expect(db.issue.update({ priority: 2, creator: 'John Doe' }).where({ id: 1 }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            2,
            "John Doe",
            1,
          ],
          "query": "UPDATE 'issue' SET priority = ?, creator = ? WHERE id = ?",
        }
      `)
    })

    it('should handle DELETE queries', () => {
      expect(db.todos.delete().where({ status: 'completed' }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
          ],
          "query": "DELETE FROM 'todos' WHERE status = ?",
        }
      `)
    })

    it('should handle INSERT with ON CONFLICT', () => {
      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'ignore').asSql())
        .toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
        }
      `)

      expect(
        db.todos
          .insert({ id: '123', text: 'Buy milk', status: 'active' })
          .onConflict('id', 'update', { text: 'Buy soy milk', status: 'active' })
          .asSql(),
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
        }
      `)

      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'replace').asSql())
        .toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT OR REPLACE INTO 'todos' (id, text, status) VALUES (?, ?, ?)",
        }
      `)
    })

    it('should handle ON CONFLICT with multiple columns', () => {
      expect(
        db.todos
          .insert({ id: '123', text: 'Buy milk', status: 'active' })
          .onConflict(['id', 'status'], 'ignore')
          .asSql(),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?) ON CONFLICT (id, status) DO NOTHING",
        }
      `)
    })

    it('should handle RETURNING clause', () => {
      expect(db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).returning('id').asSql())
        .toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
            "Buy milk",
            "active",
          ],
          "query": "INSERT INTO 'todos' (id, text, status) VALUES (?, ?, ?) RETURNING id",
        }
      `)

      expect(db.todos.update({ status: 'completed' }).where({ id: '123' }).returning('id').asSql())
        .toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
            "123",
          ],
          "query": "UPDATE 'todos' SET status = ? WHERE id = ? RETURNING id",
        }
      `)

      expect(db.todos.delete().where({ status: 'completed' }).returning('id').asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "completed",
          ],
          "query": "DELETE FROM 'todos' WHERE status = ? RETURNING id",
        }
      `)
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
