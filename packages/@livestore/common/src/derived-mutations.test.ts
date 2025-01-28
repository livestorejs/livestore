import { describe, expect, test } from 'vitest'

import { appConfig, todos } from './__tests__/fixture.js'
import type * as MutationEvent from './schema/MutationEvent.js'

describe('derived mutations', () => {
  test('todos', () => {
    expect(patchId(todos.insert({ id: 't1', completed: true, text: 'Task 1' }))).toMatchInlineSnapshot(`
      {
        "args": {
          "completed": true,
          "id": "t1",
          "text": "Task 1",
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "_Derived_Create_todos",
      }
    `)

    expect(patchId(todos.update({ where: { id: 't1' }, values: { text: 'Task 1 - fixed' } }))).toMatchInlineSnapshot(`
      {
        "args": {
          "values": {
            "text": "Task 1 - fixed",
          },
          "where": {
            "id": "t1",
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "_Derived_Update_todos",
      }
    `)

    expect(patchId(todos.delete({ where: { id: 't1' } }))).toMatchInlineSnapshot(`
      {
        "args": {
          "where": {
            "id": "t1",
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "_Derived_Delete_todos",
      }
    `)
  })

  test('app_config', () => {
    expect(patchId(appConfig.insert())).toMatchInlineSnapshot(`
      {
        "args": {
          "id": "singleton",
          "value": {
            "value": undefined,
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "_Derived_Create_app_config",
      }
    `)

    expect(patchId(appConfig.insert({ fontSize: 12, theme: 'dark' }))).toMatchInlineSnapshot(`
      {
        "args": {
          "id": "singleton",
          "value": {
            "value": {
              "fontSize": 12,
              "theme": "dark",
            },
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "_Derived_Create_app_config",
      }
    `)

    expect(patchId(appConfig.update({ fontSize: 13 }))).toMatchInlineSnapshot(`
      {
        "args": {
          "values": {
            "value": {
              "fontSize": 13,
            },
          },
          "where": {
            "id": "singleton",
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "_Derived_Update_app_config",
      }
    `)
  })
})

const patchId = (muationEvent: MutationEvent.PartialAnyDecoded) => {
  // TODO use new id paradigm
  const id = `00000000-0000-0000-0000-000000000000`
  return { ...muationEvent, id }
}
