import { describe, expect, test } from 'vitest'

import { tables } from '../__tests__/fixture.js'
import type * as LiveStoreEvent from './LiveStoreEvent.js'

describe('client document table', () => {
  test('setter', () => {
    expect(patchId(tables.UiState.set({ showSidebar: false }, 'session-1'))).toMatchInlineSnapshot(`
      {
        "args": {
          "id": "session-1",
          "value": {
            "showSidebar": false,
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "UiStateSet",
      }
    `)

    expect(patchId(tables.appConfig.set({ fontSize: 12, theme: 'dark' }))).toMatchInlineSnapshot(`
      {
        "args": {
          "id": "static",
          "value": {
            "fontSize": 12,
            "theme": "dark",
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "mutation": "AppConfigSet",
      }
    `)
  })
})

const patchId = (muationEvent: LiveStoreEvent.PartialAnyDecoded) => {
  // TODO use new id paradigm
  const id = `00000000-0000-0000-0000-000000000000`
  return { ...muationEvent, id }
}
