import { defineEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

import { compactEvents } from '../compact-events.js'
import { historyDagFromNodes } from '../history-dag.js'
import { customSerializer } from './compact-events.test.js'
import { toEventNodes } from './mutation-fixtures.js'

expect.addSnapshotSerializer(customSerializer)

const compact = (events: any[]) => {
  const dag = historyDagFromNodes(toEventNodes(events, mutations, 'client-id', 'session-id'))
  const compacted = compactEvents(dag)

  return Array.from(compacted.dag.nodeEntries())
    .map((_) => _.attributes)
    .map(({ factsGroup, ...rest }) => ({ ...rest, facts: factsGroup }))
    .slice(1)
}

const facts = {
  multiplyByZero: `multiplyByZero`,
}

const mutations = {
  add: defineEvent({
    name: 'add',
    schema: Schema.Struct({ value: Schema.Number }),
  }),
  multiply: defineEvent({
    name: 'multiply',
    schema: Schema.Struct({ value: Schema.Number }),
    facts: ({ value }, currentFacts) => ({
      modify: {
        set: value === 0 || currentFacts.has(facts.multiplyByZero) ? [facts.multiplyByZero] : [],
        unset: value === 0 ? [] : [facts.multiplyByZero],
      },
    }),
  }),
  // TODO divide by zero
}

describe('compactEvents calculator', () => {
  it('1 + 1', () => {
    const expected = compact([
      mutations.add({ value: 1 }), // 0
      mutations.add({ value: 1 }), // 1
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { id: 1, parentId: 0, mutation: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
        { id: 2, parentId: 1, mutation: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
      ]
    `)
  })

  it('2 * 2', () => {
    const expected = compact([
      mutations.multiply({ value: 2 }), // 0
      mutations.multiply({ value: 2 }), // 1
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { id: 1, parentId: 0, mutation: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero -multiplyByZero" }
        { id: 2, parentId: 1, mutation: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero -multiplyByZero" }
      ]
    `)
  })

  it('2 * 2 * 0', () => {
    const expected = compact([
      mutations.multiply({ value: 2 }), // 0
      mutations.multiply({ value: 2 }), // 1
      mutations.multiply({ value: 0 }), // 2
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { id: 3, parentId: 0, mutation: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
      ]
    `)
  })

  it('2 * 2 * 0 + 1', () => {
    const expected = compact([
      mutations.multiply({ value: 2 }), // 0
      mutations.multiply({ value: 2 }), // 1
      mutations.multiply({ value: 0 }), // 2
      mutations.add({ value: 1 }), // 3
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { id: 3, parentId: 0, mutation: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
        { id: 4, parentId: 3, mutation: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
      ]
    `)
  })

  it('1 + 2 * 0 * 2 + 1', () => {
    const expected = compact([
      mutations.add({ value: 1 }), // 0
      mutations.multiply({ value: 2 }), // 1
      mutations.multiply({ value: 0 }), // 2
      mutations.multiply({ value: 2 }), // 3
      mutations.add({ value: 1 }), // 4
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { id: 1, parentId: 0, mutation: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
        { id: 3, parentId: 1, mutation: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
        { id: 4, parentId: 3, mutation: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero +multiplyByZero -multiplyByZero" }
        { id: 5, parentId: 4, mutation: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
      ]
    `)
  })
})
