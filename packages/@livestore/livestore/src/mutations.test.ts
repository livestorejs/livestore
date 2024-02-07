import { describe, expect, test } from 'vitest'

import { schema } from './__tests__/react/fixture.js'
import type { MutationEvent } from './index.js'
import { makeMutations } from './mutations.js'

describe('mutations', () => {
  const mutations = makeMutations(schema)

  test('basic', () => {
    expect(patchId(mutations.todos.insert({ id: 't1', completed: true, text: 'Task 1' }))).toMatchInlineSnapshot(`
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
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "livestore.RawSql",
      }
    `)

    expect(patchId(mutations.todos.update({ where: { id: 't1' }, values: { text: 'Task 1 - fixed' } })))
      .toMatchInlineSnapshot(`
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
          "id": "00000000-0000-0000-0000-000000000000",
          "mutation": "livestore.RawSql",
        }
      `)
  })
})

const patchId = (muationEvent: MutationEvent.Any) => {
  const id = `00000000-0000-0000-0000-000000000000`
  return { ...muationEvent, id }
}
