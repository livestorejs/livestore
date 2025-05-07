import { defineEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

import { compactEvents } from '../compact-events.js'
import { historyDagFromNodes } from '../history-dag.js'
import { customSerializer } from './compact-events.test.js'
import { toEventNodes } from './event-fixtures.js'

expect.addSnapshotSerializer(customSerializer)

const compact = (events: any[]) => {
  const dag = historyDagFromNodes(toEventNodes(events, eventDefs, 'client-id', 'session-id'))
  const compacted = compactEvents(dag)

  return Array.from(compacted.dag.nodeEntries())
    .map((_) => _.attributes)
    .map(({ factsGroup, ...rest }) => ({ ...rest, facts: factsGroup }))
    .slice(1)
}

const facts = {
  multiplyByZero: `multiplyByZero`,
}

const eventDefs = {
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
      eventDefs.add({ value: 1 }), // 0
      eventDefs.add({ value: 1 }), // 1
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: 1, parentSeqNum: 0, name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
        { seqNum: 2, parentSeqNum: 1, name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
      ]
    `)
  })

  it('2 * 2', () => {
    const expected = compact([
      eventDefs.multiply({ value: 2 }), // 0
      eventDefs.multiply({ value: 2 }), // 1
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: 1, parentSeqNum: 0, name: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero -multiplyByZero" }
        { seqNum: 2, parentSeqNum: 1, name: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero -multiplyByZero" }
      ]
    `)
  })

  it('2 * 2 * 0', () => {
    const expected = compact([
      eventDefs.multiply({ value: 2 }), // 0
      eventDefs.multiply({ value: 2 }), // 1
      eventDefs.multiply({ value: 0 }), // 2
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: 3, parentSeqNum: 0, name: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
      ]
    `)
  })

  it('2 * 2 * 0 + 1', () => {
    const expected = compact([
      eventDefs.multiply({ value: 2 }), // 0
      eventDefs.multiply({ value: 2 }), // 1
      eventDefs.multiply({ value: 0 }), // 2
      eventDefs.add({ value: 1 }), // 3
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: 3, parentSeqNum: 0, name: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
        { seqNum: 4, parentSeqNum: 3, name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
      ]
    `)
  })

  it('1 + 2 * 0 * 2 + 1', () => {
    const expected = compact([
      eventDefs.add({ value: 1 }), // 0
      eventDefs.multiply({ value: 2 }), // 1
      eventDefs.multiply({ value: 0 }), // 2
      eventDefs.multiply({ value: 2 }), // 3
      eventDefs.add({ value: 1 }), // 4
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: 1, parentSeqNum: 0, name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
        { seqNum: 3, parentSeqNum: 1, name: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
        { seqNum: 4, parentSeqNum: 3, name: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero +multiplyByZero -multiplyByZero" }
        { seqNum: 5, parentSeqNum: 4, name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
      ]
    `)
  })
})
