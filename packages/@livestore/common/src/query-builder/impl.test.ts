import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

import { DbSchema } from '../schema/index.js'
import { getResultSchema } from './impl.js'

const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
    status: DbSchema.text({ schema: Schema.Literal('active', 'completed') }),
    deletedAt: DbSchema.datetime({ nullable: true }),
    // TODO consider leaning more into Effect schema
    // other: Schema.Number.pipe(DbSchema.asInteger),
  },
  { deriveMutations: true },
)

const todos2 = DbSchema.table(
  'todos2',
  {
    id: DbSchema.integer({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    status: DbSchema.text({ schema: Schema.Literal('active', 'completed') }),
  },
  { deriveMutations: true },
)

const comments = DbSchema.table('comments', {
  id: DbSchema.text({ primaryKey: true }),
  text: DbSchema.text({ default: '', nullable: false }),
  todoId: DbSchema.text({}),
})

const db = { todos: todos.query, todos2: todos2.query, comments: comments.query }

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

  describe('row queries', () => {
    it('should handle row queries', () => {
      expect(db.todos.row('123', { insertValues: { status: 'completed' } }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "123",
          ],
          "query": "SELECT * FROM 'todos' WHERE id = ?",
        }
      `)
    })

    it('should handle row queries with numbers', () => {
      expect(db.todos2.row(123, { insertValues: { status: 'active' } }).asSql()).toMatchInlineSnapshot(`
        {
          "bindValues": [
            123,
          ],
          "query": "SELECT * FROM 'todos2' WHERE id = ?",
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
