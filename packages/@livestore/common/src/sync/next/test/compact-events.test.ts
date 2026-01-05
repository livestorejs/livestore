import { describe, expect, it } from 'vitest'

import { compactEvents } from '../compact-events.ts'
import { historyDagFromNodes } from '../history-dag.ts'
import { customSerializer, events as eventDefs, printEvent, toEventNodes } from './event-fixtures.ts'

expect.addSnapshotSerializer(customSerializer)

const compact = (events: any[]) => {
  const dag = historyDagFromNodes(toEventNodes(events, eventDefs, 'client-id', 'session-id'))
  const compacted = compactEvents(dag)

  return Array.from(compacted.dag.nodeEntries())
    .map((_) => _.attributes)
    .map(printEvent)
    .slice(1)
}

describe('compactEvents todo app', () => {
  it('todoCompleted', () => {
    const expected = compact([
      eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
      eventDefs.todoCompleted({ id: 'A' }), // 1
      eventDefs.todoCompleted({ id: 'A' }), // 2
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: "e1", parentSeqNum: "e0", name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { seqNum: "e3", parentSeqNum: "e1", name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
      ]
    `)
  })

  it('toggleTodo', () => {
    const expected = compact([
      eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
      eventDefs.toggleTodo({ id: 'A' }), // 1
      eventDefs.toggleTodo({ id: 'A' }), // 2
      eventDefs.toggleTodo({ id: 'A' }), // 3
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: "e1", parentSeqNum: "e0", name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { seqNum: "e2", parentSeqNum: "e1", name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=true" }
        { seqNum: "e3", parentSeqNum: "e2", name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=false" }
        { seqNum: "e4", parentSeqNum: "e3", name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=true" }
      ]
    `)
  })

  it('todoCompleted / toggleTodo', () => {
    const expected = compact([
      eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
      eventDefs.toggleTodo({ id: 'A' }), // 1
      eventDefs.toggleTodo({ id: 'A' }), // 2
      eventDefs.todoCompleted({ id: 'A' }), // 3
      eventDefs.todoCompleted({ id: 'A' }), // 4
      eventDefs.toggleTodo({ id: 'A' }), // 5
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: "e1", parentSeqNum: "e0", name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { seqNum: "e5", parentSeqNum: "e1", name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
        { seqNum: "e6", parentSeqNum: "e5", name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=false" }
      ]
    `)
  })

  it('readonly setTextTodo', () => {
    const expected = compact([
      eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
      eventDefs.setReadonlyTodo({ id: 'A', readonly: false }), // 1
      eventDefs.setTextTodo({ id: 'A', text: 'buy soy milk' }), // 2
      eventDefs.setReadonlyTodo({ id: 'A', readonly: true }), // 3
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: "e1", parentSeqNum: "e0", name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { seqNum: "e2", parentSeqNum: "e1", name: "setReadonlyTodo", args: { id: "A", readonly: false }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=true" }
        { seqNum: "e3", parentSeqNum: "e2", name: "setTextTodo", args: { id: "A", text: "buy soy milk" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-text-updated-A" }
        { seqNum: "e4", parentSeqNum: "e3", name: "setReadonlyTodo", args: { id: "A", readonly: true }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=false" }
      ]
    `)
  })

  it('readonly setTextTodo 2', () => {
    const expected = compact([
      eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
      eventDefs.setReadonlyTodo({ id: 'A', readonly: false }), // 1
      eventDefs.todoCompleted({ id: 'A' }), // 2
      eventDefs.setTextTodo({ id: 'A', text: 'buy soy milk' }), // 3
      eventDefs.setReadonlyTodo({ id: 'A', readonly: true }), // 4
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: "e1", parentSeqNum: "e0", name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { seqNum: "e2", parentSeqNum: "e1", name: "setReadonlyTodo", args: { id: "A", readonly: false }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=true" }
        { seqNum: "e3", parentSeqNum: "e2", name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
        { seqNum: "e4", parentSeqNum: "e3", name: "setTextTodo", args: { id: "A", text: "buy soy milk" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-text-updated-A" }
        { seqNum: "e5", parentSeqNum: "e4", name: "setReadonlyTodo", args: { id: "A", readonly: true }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=false" }
      ]
    `)
  })

  it('readonly setTextTodo - should fail', () => {
    const expected = () =>
      compact([
        eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
        eventDefs.setReadonlyTodo({ id: 'A', readonly: false }), // 1
        eventDefs.setTextTodo({ id: 'A', text: 'buy soy milk' }), // 2
        eventDefs.setReadonlyTodo({ id: 'A', readonly: true }), // 3
        eventDefs.setTextTodo({ id: 'A', text: 'buy oat milk' }), // 4
      ])

    expect(expected).toThrowErrorMatchingInlineSnapshot(`
      [Error: Event setTextTodo requires facts that have not been set yet.
      Requires: todo-exists-A, todo-is-writeable-A=true
      Facts Snapshot: todo-exists-A, todo-is-writeable-A=false, todo-completed-A=false, todo-text-updated-A]
    `)
  })

  it('todoCompleteds', () => {
    const expected = compact([
      eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
      eventDefs.createTodo({ id: 'B', text: 'buy bread' }), // 1
      eventDefs.createTodo({ id: 'C', text: 'buy cheese' }), // 2
      eventDefs.todoCompleteds({ ids: ['A', 'B', 'C'] }), // 3
      eventDefs.toggleTodo({ id: 'A' }), // 4
      eventDefs.todoCompleted({ id: 'A' }), // 5
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: "e1", parentSeqNum: "e0", name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { seqNum: "e2", parentSeqNum: "e1", name: "createTodo", args: { id: "B", text: "buy bread" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-B +todo-is-writeable-B=true +todo-completed-B=false" }
        { seqNum: "e3", parentSeqNum: "e2", name: "createTodo", args: { id: "C", text: "buy cheese" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-C +todo-is-writeable-C=true +todo-completed-C=false" }
        { seqNum: "e4", parentSeqNum: "e3", name: "todoCompleteds", args: { ids: ["A", "B", "C"] }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ↖todo-exists-B ↖todo-is-writeable-B=true ↖todo-exists-C ↖todo-is-writeable-C=true +todo-completed-A=true +todo-completed-B=true +todo-completed-C=true" }
        { seqNum: "e6", parentSeqNum: "e4", name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
      ]
    `)
  })

  it('todoCompleteds 2', () => {
    const expected = compact([
      eventDefs.createTodo({ id: 'A', text: 'buy milk' }), // 0
      eventDefs.createTodo({ id: 'B', text: 'buy bread' }), // 1
      eventDefs.createTodo({ id: 'C', text: 'buy cheese' }), // 2
      eventDefs.toggleTodo({ id: 'A' }), // 3
      eventDefs.todoCompleteds({ ids: ['A', 'B', 'C'] }), // 4
      eventDefs.toggleTodo({ id: 'A' }), // 5
      eventDefs.todoCompleted({ id: 'A' }), // 6
    ])

    expect(expected).toMatchInlineSnapshot(`
      [
        { seqNum: "e1", parentSeqNum: "e0", name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { seqNum: "e2", parentSeqNum: "e1", name: "createTodo", args: { id: "B", text: "buy bread" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-B +todo-is-writeable-B=true +todo-completed-B=false" }
        { seqNum: "e3", parentSeqNum: "e2", name: "createTodo", args: { id: "C", text: "buy cheese" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-C +todo-is-writeable-C=true +todo-completed-C=false" }
        { seqNum: "e5", parentSeqNum: "e3", name: "todoCompleteds", args: { ids: ["A", "B", "C"] }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ↖todo-exists-B ↖todo-is-writeable-B=true ↖todo-exists-C ↖todo-is-writeable-C=true +todo-completed-A=true +todo-completed-B=true +todo-completed-C=true" }
        { seqNum: "e7", parentSeqNum: "e5", name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
      ]
    `)
  })
})
