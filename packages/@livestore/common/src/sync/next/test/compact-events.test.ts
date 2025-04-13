import type { EventDefFacts } from '@livestore/common/schema'
import { describe, expect, it } from 'vitest'

import { compactEvents } from '../compact-events.js'
import { historyDagFromNodes } from '../history-dag.js'
import type { HistoryDagNode } from '../history-dag-common.js'
import { EMPTY_FACT_VALUE } from '../history-dag-common.js'
import { events as eventDefs, toEventNodes } from './event-fixtures.js'

const customStringify = (value: any): string => {
  if (value === null) {
    return 'null'
  }
  const type = typeof value

  if (type === 'string') {
    return JSON.stringify(value)
  }
  if (type === 'number' || type === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const elements = value.map((el) => customStringify(el))
    return `[${elements.join(', ')}]`
  }
  if (value instanceof Set) {
    const elements = Array.from(value).map((el) => customStringify(el))
    return `[${elements.join(', ')}]`
  }
  if (value instanceof Map) {
    const keys = Array.from(value.keys()).map(customStringify).join(', ')
    return `[${keys}]`
  }
  if (type === 'object') {
    const entries = Object.keys(value).map((key) => {
      const val = value[key]
      const valStr =
        key === 'facts'
          ? `"${factsToString(val)}"`
          : (key === 'id' || key === 'parentId') && Object.keys(val).length === 2 && val.client === 0
            ? val.global
            : customStringify(val)

      return `${key}: ${valStr}`
    })
    return `{ ${entries.join(', ')} }`
  }
  return String(value)
}

const factsToString = (facts: HistoryDagNode['factsGroup']) =>
  [
    factsSetToString(facts.depRequire, '↖'),
    factsSetToString(facts.depRead, '?'),
    factsSetToString(facts.modifySet, '+'),
    factsSetToString(facts.modifyUnset, '-'),
  ]
    .flat()
    .join(' ')

const factsSetToString = (facts: EventDefFacts, prefix: string) =>
  Array.from(facts.entries()).map(([key, value]) => prefix + key + (value === EMPTY_FACT_VALUE ? '' : `=${value}`))

export const customSerializer = {
  test: (val: unknown) => Array.isArray(val),
  print: (val: unknown[], _serialize: (item: unknown) => string) => {
    return '[\n' + (val as any[]).map((item) => '  ' + customStringify(item)).join('\n') + '\n]'
  },
} as any

expect.addSnapshotSerializer(customSerializer)

const compact = (events: any[]) => {
  const dag = historyDagFromNodes(toEventNodes(events, eventDefs, 'client-id', 'session-id'))
  const compacted = compactEvents(dag)

  return Array.from(compacted.dag.nodeEntries())
    .map((_) => _.attributes)
    .map(({ factsGroup, ...rest }) => ({ ...rest, facts: factsGroup }))
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
        { id: 1, parentId: 0, name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { id: 3, parentId: 1, name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
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
        { id: 1, parentId: 0, name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { id: 2, parentId: 1, name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=true" }
        { id: 3, parentId: 2, name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=false" }
        { id: 4, parentId: 3, name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=true" }
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
        { id: 1, parentId: 0, name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { id: 5, parentId: 1, name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
        { id: 6, parentId: 5, name: "toggleTodo", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ?todo-completed-A +todo-completed-A=false" }
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
        { id: 1, parentId: 0, name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { id: 2, parentId: 1, name: "setReadonlyTodo", args: { id: "A", readonly: false }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=true" }
        { id: 3, parentId: 2, name: "setTextTodo", args: { id: "A", text: "buy soy milk" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-text-updated-A" }
        { id: 4, parentId: 3, name: "setReadonlyTodo", args: { id: "A", readonly: true }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=false" }
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
        { id: 1, parentId: 0, name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { id: 2, parentId: 1, name: "setReadonlyTodo", args: { id: "A", readonly: false }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=true" }
        { id: 3, parentId: 2, name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
        { id: 4, parentId: 3, name: "setTextTodo", args: { id: "A", text: "buy soy milk" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-text-updated-A" }
        { id: 5, parentId: 4, name: "setReadonlyTodo", args: { id: "A", readonly: true }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A +todo-is-writeable-A=false" }
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
        { id: 1, parentId: 0, name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { id: 2, parentId: 1, name: "createTodo", args: { id: "B", text: "buy bread" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-B +todo-is-writeable-B=true +todo-completed-B=false" }
        { id: 3, parentId: 2, name: "createTodo", args: { id: "C", text: "buy cheese" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-C +todo-is-writeable-C=true +todo-completed-C=false" }
        { id: 4, parentId: 3, name: "todoCompleteds", args: { ids: ["A", "B", "C"] }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ↖todo-exists-B ↖todo-is-writeable-B=true ↖todo-exists-C ↖todo-is-writeable-C=true +todo-completed-A=true +todo-completed-B=true +todo-completed-C=true" }
        { id: 6, parentId: 4, name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
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
        { id: 1, parentId: 0, name: "createTodo", args: { id: "A", text: "buy milk" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-A +todo-is-writeable-A=true +todo-completed-A=false" }
        { id: 2, parentId: 1, name: "createTodo", args: { id: "B", text: "buy bread" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-B +todo-is-writeable-B=true +todo-completed-B=false" }
        { id: 3, parentId: 2, name: "createTodo", args: { id: "C", text: "buy cheese" }, clientId: "client-id", sessionId: "session-id", facts: "+todo-exists-C +todo-is-writeable-C=true +todo-completed-C=false" }
        { id: 5, parentId: 3, name: "todoCompleteds", args: { ids: ["A", "B", "C"] }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true ↖todo-exists-B ↖todo-is-writeable-B=true ↖todo-exists-C ↖todo-is-writeable-C=true +todo-completed-A=true +todo-completed-B=true +todo-completed-C=true" }
        { id: 7, parentId: 5, name: "todoCompleted", args: { id: "A" }, clientId: "client-id", sessionId: "session-id", facts: "↖todo-exists-A ↖todo-is-writeable-A=true +todo-completed-A=true" }
      ]
    `)
  })
})
