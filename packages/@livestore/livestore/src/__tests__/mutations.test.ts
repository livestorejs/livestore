import { describe, expect, test } from 'vitest'

import { makeMutations } from '../mutations.js'
import { schema } from './react/fixture.js'

describe('mutations', () => {
  const mutations = makeMutations(schema)

  test('basic', () => {
    expect(mutations.todos.insert({ id: 't1', completed: true, text: 'Task 1' })).toMatchInlineSnapshot(`
      {
        "args": {
          "bindValues": {
            "completed": 1,
            "id": "t1",
            "text": "Task 1",
          },
          "sql": "INSERT  INTO todos (id, text, completed) VALUES ($id, $text, $completed)",
          "writeTables": Set {
            "todos",
          },
        },
        "mutation": "livestore.RawSql",
      }
    `)

    expect(mutations.todos.update({ where: { id: 't1' }, values: { text: 'Task 1 - fixed' } })).toMatchInlineSnapshot(`
      {
        "args": {
          "bindValues": {
            "update_text": "Task 1 - fixed",
            "where_id": "t1",
          },
          "sql": "UPDATE todos SET text = $update_text WHERE id = $where_id",
          "writeTables": Set {
            "todos",
          },
        },
        "mutation": "livestore.RawSql",
      }
    `)
  })
})
