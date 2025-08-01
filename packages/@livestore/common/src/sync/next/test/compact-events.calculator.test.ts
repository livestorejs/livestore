import { defineEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

import { compactEvents } from '../compact-events.ts'
import { historyDagFromNodes } from '../history-dag.ts'
import { customSerializer } from './compact-events.test.ts'
import { printEvent, toEventNodes } from './event-fixtures.ts'

expect.addSnapshotSerializer(customSerializer)

const compact = (events: any[]) => {
  const dag = historyDagFromNodes(toEventNodes(events, eventDefs, 'client-id', 'session-id'))
  const compacted = compactEvents(dag)

  return Array.from(compacted.dag.nodeEntries())
    .map((_) => _.attributes)
    .map(printEvent)
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
        { seqNum: "e1", parentSeqNum: "e0", name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
        { seqNum: "e2", parentSeqNum: "e1", name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
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
        { seqNum: "e1", parentSeqNum: "e0", name: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero -multiplyByZero" }
        { seqNum: "e2", parentSeqNum: "e1", name: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero -multiplyByZero" }
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
        { seqNum: "e3", parentSeqNum: "e0", name: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
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
        { seqNum: "e3", parentSeqNum: "e0", name: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
        { seqNum: "e4", parentSeqNum: "e3", name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
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
        { seqNum: "e1", parentSeqNum: "e0", name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
        { seqNum: "e3", parentSeqNum: "e1", name: "multiply", args: { value: 0 }, clientId: "client-id", sessionId: "session-id", facts: "+multiplyByZero" }
        { seqNum: "e4", parentSeqNum: "e3", name: "multiply", args: { value: 2 }, clientId: "client-id", sessionId: "session-id", facts: "?multiplyByZero +multiplyByZero -multiplyByZero" }
        { seqNum: "e5", parentSeqNum: "e4", name: "add", args: { value: 1 }, clientId: "client-id", sessionId: "session-id", facts: "" }
      ]
    `)
  })
})
