import { Schema } from '@livestore/utils/effect'

import type { EventDef } from '../../../schema/EventDef.js'
import { defineEvent, defineFacts } from '../../../schema/EventDef.js'
import * as EventId from '../../../schema/EventId.js'
import { factsSnapshotForDag, getFactsGroupForEventArgs } from '../facts.js'
import { historyDagFromNodes } from '../history-dag.js'
import type { HistoryDagNode } from '../history-dag-common.js'
import { rootEventNode } from '../history-dag-common.js'

/** Used for conflict detection and event history compaction */
export const facts = defineFacts({
  todoExists: (id: string) => `todo-exists-${id}`,
  todoIsWriteable: (id: string, writeable: boolean) => [`todo-is-writeable-${id}`, writeable],
  todoCompleted: (id: string, completed: boolean) => [`todo-completed-${id}`, completed],
  todoTextUpdated: (id: string) => `todo-text-updated-${id}`,
  inputValue: (id: string) => `input-value-${id}`,
})

export const events = {
  createTodo: defineEvent({
    name: 'createTodo',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    // 'INSERT INTO todos (id, text) VALUES ($id, $text)',
    // {
    facts: ({ id }) => ({
      modify: {
        set: [facts.todoExists(id), facts.todoIsWriteable(id, true), facts.todoCompleted(id, false)],
      },
    }),
  }),
  upsertTodo: defineEvent({
    name: 'upsertTodo',
    schema: Schema.Struct({ id: Schema.String, text: Schema.optional(Schema.String) }),
    // 'INSERT INTO todos (id, text) VALUES ($id, $text) ON CONFLICT (id) DO UPDATE SET text = $text',
    // {
    facts: ({ id }, currentFacts) =>
      // TODO enable an API along the lines of `map.has(key, value)`
      currentFacts.has(facts.todoExists(id)) && currentFacts.get(facts.todoIsWriteable(id, true)[0]) === false
        ? { require: [facts.todoExists(id), facts.todoIsWriteable(id, true)] }
        : { modify: { set: [facts.todoExists(id), facts.todoIsWriteable(id, true), facts.todoTextUpdated(id)] } },
  }),
  todoCompleted: defineEvent({
    name: 'todoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
    // consider `RETURNING` to validate before applying facts
    // 'UPDATE todos SET completed = true WHERE id = $id',
    // {
    // prewrite assertions from DB
    // enables more concurrency
    // turning database inside out
    // similar to upsert semantics
    facts: ({ id }) => ({
      require: [facts.todoExists(id), facts.todoIsWriteable(id, true)],
      modify: { set: [facts.todoCompleted(id, true)] },
    }),
  }),
  todoUncompleted: defineEvent({
    name: 'todoUncompleted',
    schema: Schema.Struct({ id: Schema.String }),
    // 'UPDATE todos SET completed = false WHERE id = $id',
    // {
    facts: ({ id }) => ({
      require: [facts.todoExists(id), facts.todoIsWriteable(id, true)],
      modify: { set: [facts.todoCompleted(id, false)] },
    }),
  }),
  todoCompleteds: defineEvent({
    name: 'todoCompleteds',
    schema: Schema.Struct({ ids: Schema.Array(Schema.String) }),
    // 'UPDATE todos SET completed = true WHERE id IN ($ids:csv)',
    // {
    facts: ({ ids }) => ({
      require: ids.flatMap((id) => [facts.todoExists(id), facts.todoIsWriteable(id, true)]),
      modify: { set: ids.map((id) => facts.todoCompleted(id, true)) },
    }),
  }),
  toggleTodo: defineEvent({
    name: 'toggleTodo',
    schema: Schema.Struct({ id: Schema.String }),
    // 'UPDATE todos SET completed = NOT completed WHERE id = $id',
    // {
    facts: ({ id }, currentFacts) => {
      const currentIsCompleted = currentFacts.get(facts.todoCompleted(id, true)[0]) === true
      return {
        require: [facts.todoExists(id), facts.todoIsWriteable(id, true)],
        modify: {
          // remove: [facts.todoCompleted(id, currentIsCompleted)],
          set: [facts.todoCompleted(id, !currentIsCompleted)],
        },
      }
    },
  }),
  setReadonlyTodo: defineEvent({
    name: 'setReadonlyTodo',
    schema: Schema.Struct({ id: Schema.String, readonly: Schema.Boolean }),
    // 'UPDATE todos SET readonly = $readonly WHERE id = $id',
    // {
    facts: ({ id, readonly }) => ({
      require: [facts.todoExists(id)],
      modify: { set: [facts.todoIsWriteable(id, !readonly)] },
    }),
  }),
  setTextTodo: defineEvent({
    name: 'setTextTodo',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    // 'UPDATE todos SET text = $text WHERE id = $id',
    // {
    facts: ({ id }) => ({
      require: [facts.todoExists(id), facts.todoIsWriteable(id, true)],
      modify: { set: [facts.todoTextUpdated(id)] },
    }),
  }),
  setInputValue: defineEvent({
    name: 'setInputValue',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    // 'UPDATE todos SET text = $text WHERE id = $id',
    // {
    clientOnly: true,
    facts: ({ id }) => ({ modify: { set: [facts.inputValue(id)] } }),
  }),
}

export type PartialEvent = { name: string; args: any }

export const toEventNodes = (
  partialEvents: PartialEvent[],
  eventDefs: Record<string, EventDef.Any>,
  clientId: string,
  sessionId: string | undefined,
): HistoryDagNode[] => {
  const nodesAcc: HistoryDagNode[] = [rootEventNode]

  let currentEventId: EventId.EventId = EventId.ROOT

  const eventNodes = partialEvents.map((partialEvent) => {
    const eventDef = eventDefs[partialEvent.name]!
    const eventId = EventId.nextPair(currentEventId, eventDef.options.clientOnly).id
    currentEventId = eventId

    const factsSnapshot = factsSnapshotForDag(historyDagFromNodes(nodesAcc, { skipFactsCheck: true }), undefined)
    // console.log('factsSnapshot', eventId, factsSnapshot)
    // const depRead: EventDefFactsSnapshot = new Map<string, any>()
    // const factsSnapshotProxy = new Proxy(factsSnapshot, {
    //   get: (target, prop) => {
    //     if (prop === 'has') {
    //       return (key: string) => {
    //         depRead.set(key, EMPTY_FACT_VALUE)
    //         return target.has(key)
    //       }
    //     } else if (prop === 'get') {
    //       return (key: string) => {
    //         depRead.set(key, EMPTY_FACT_VALUE)
    //         return target.get(key)
    //       }
    //     }

    //     notYetImplemented(`toEventNodes: ${prop.toString()} is not yet implemented`)
    //   },
    // })

    // const factsRes = eventDef.options.facts?.(partialEvent.args, factsSnapshotProxy)
    // console.log('factsRes', factsRes?.modify, factsRes?.require)
    // const iterableToMap = (iterable: Iterable<EventDefFactInput>) => {
    //   const map = new Map()
    //   for (const item of iterable) {
    //     if (typeof item === 'string') {
    //       map.set(item, EMPTY_FACT_VALUE)
    //     } else {
    //       map.set(item[0], item[1])
    //     }
    //   }
    //   return map
    // }
    // const facts = {
    //   modifyAdd: factsRes?.modify.add ? iterableToMap(factsRes.modify.add) : new Map(),
    //   modifyRemove: factsRes?.modify.remove ? iterableToMap(factsRes.modify.remove) : new Map(),
    //   depRequire: factsRes?.require ? iterableToMap(factsRes.require) : new Map(),
    //   depRead,
    // } satisfies EventDefFactsGroup

    // applyFactGroup(facts, factsSnapshot)

    const facts = getFactsGroupForEventArgs({
      factsCallback: eventDef.options.facts,
      args: partialEvent.args,
      currentFacts: factsSnapshot,
    })

    const node = {
      id: eventId,
      parentId: getParentId(eventId),
      name: partialEvent.name,
      args: partialEvent.args,
      factsGroup: facts,
      clientId,
      sessionId,
    } satisfies HistoryDagNode
    nodesAcc.push(node)
    return node
  })

  eventNodes.unshift(rootEventNode as never)

  // console.log('eventNodes', eventNodes)

  return eventNodes
}

const getParentId = (eventId: EventId.EventId): EventId.EventId => {
  const globalParentId = eventId.global
  const clientParentId = eventId.client - 1

  if (clientParentId < 0) {
    return EventId.make({ global: globalParentId - 1, client: EventId.clientDefault })
  }

  return EventId.make({ global: globalParentId, client: clientParentId })
}
