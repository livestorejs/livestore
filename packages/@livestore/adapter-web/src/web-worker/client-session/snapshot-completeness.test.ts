import { UnknownError } from '@livestore/common'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { Effect, Either, Schema } from '@livestore/utils/effect'
import { describe, expect, test } from 'vitest'

import { ensureSnapshotsByBackendComplete } from './snapshot-completeness.ts'

const tablesA = {
  items: State.SQLite.table({
    name: 'items',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
    },
  }),
}

const tablesB = {
  items: State.SQLite.table({
    name: 'items',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
    },
  }),
}

const eventsA = {
  aItemCreated: Events.synced({
    name: 'v1.AItemCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const eventsB = {
  bItemCreated: Events.synced({
    name: 'v1.BItemCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const backendA = State.SQLite.makeBackend({
  id: 'a',
  tables: tablesA,
  materializers: State.SQLite.materializers(eventsA, {
    'v1.AItemCreated': ({ id, title }) => tablesA.items.insert({ id, title }),
  }),
})

const backendB = State.SQLite.makeBackend({
  id: 'b',
  tables: tablesB,
  materializers: State.SQLite.materializers(eventsB, {
    'v1.BItemCreated': ({ id, title }) => tablesB.items.insert({ id, title }),
  }),
})

const schema = makeSchema({
  state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
  events: { ...eventsA, ...eventsB },
})

describe('snapshot completeness checks', () => {
  test('accepts complete snapshot maps', () => {
    const snapshotsByBackend = new Map([
      ['a', Uint8Array.from([1])],
      ['b', Uint8Array.from([2])],
    ])

    const result = Effect.runSync(
      ensureSnapshotsByBackendComplete({ schema, snapshotsByBackend, sourceTag: 'from-leader-worker' }),
    )

    expect(result).toEqual(snapshotsByBackend)
  })

  test('fails loudly when snapshot map is missing a backend', () => {
    const snapshotsByBackend = new Map([['a', Uint8Array.from([1])]])

    const result = Effect.runSync(
      Effect.either(ensureSnapshotsByBackendComplete({ schema, snapshotsByBackend, sourceTag: 'from-leader-worker' })),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(Schema.is(UnknownError)(result.left)).toBe(true)
      if (Schema.is(UnknownError)(result.left)) {
        expect(result.left.cause).toBe('Missing backend snapshots during session boot.')
        expect(result.left.payload).toEqual({
          sourceTag: 'from-leader-worker',
          missingBackendIds: ['b'],
          expectedBackendIds: ['a', 'b'],
          availableBackendIds: ['a'],
        })
      }
    }
  })
})
