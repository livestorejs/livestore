import { Schema } from '@livestore/utils/effect'

import * as EventId from '../../../schema/EventId.js'
import type { MutationDef } from '../../../schema/mutations.js'
import { defineFacts, defineMutation } from '../../../schema/mutations.js'
import { factsSnapshotForDag, getFactsGroupForMutationArgs } from '../facts.js'
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

export const mutations = {
  createTodo: defineMutation(
    'createTodo',
    Schema.Struct({ id: Schema.String, text: Schema.String }),
    'INSERT INTO todos (id, text) VALUES ($id, $text)',
    {
      facts: ({ id }) => ({
        modify: {
          set: [facts.todoExists(id), facts.todoIsWriteable(id, true), facts.todoCompleted(id, false)],
        },
      }),
    },
  ),
  upsertTodo: defineMutation(
    'upsertTodo',
    Schema.Struct({ id: Schema.String, text: Schema.optional(Schema.String) }),
    'INSERT INTO todos (id, text) VALUES ($id, $text) ON CONFLICT (id) DO UPDATE SET text = $text',
    {
      facts: ({ id }, currentFacts) =>
        // TODO enable an API along the lines of `map.has(key, value)`
        currentFacts.has(facts.todoExists(id)) && currentFacts.get(facts.todoIsWriteable(id, true)[0]) === false
          ? { require: [facts.todoExists(id), facts.todoIsWriteable(id, true)] }
          : { modify: { set: [facts.todoExists(id), facts.todoIsWriteable(id, true), facts.todoTextUpdated(id)] } },
    },
  ),
  completeTodo: defineMutation(
    'completeTodo',
    Schema.Struct({ id: Schema.String }),
    // consider `RETURNING` to validate before applying facts
    'UPDATE todos SET completed = true WHERE id = $id',
    {
      // prewrite assertions from DB
      // enables more concurrency
      // turning database inside out
      // similar to upsert semantics
      facts: ({ id }) => ({
        require: [facts.todoExists(id), facts.todoIsWriteable(id, true)],
        modify: { set: [facts.todoCompleted(id, true)] },
      }),
    },
  ),
  uncompleteTodo: defineMutation(
    'uncompleteTodo',
    Schema.Struct({ id: Schema.String }),
    'UPDATE todos SET completed = false WHERE id = $id',
    {
      facts: ({ id }) => ({
        require: [facts.todoExists(id), facts.todoIsWriteable(id, true)],
        modify: { set: [facts.todoCompleted(id, false)] },
      }),
    },
  ),
  completeTodos: defineMutation(
    'completeTodos',
    Schema.Struct({ ids: Schema.Array(Schema.String) }),
    'UPDATE todos SET completed = true WHERE id IN ($ids:csv)',
    {
      facts: ({ ids }) => ({
        require: ids.flatMap((id) => [facts.todoExists(id), facts.todoIsWriteable(id, true)]),
        modify: { set: ids.map((id) => facts.todoCompleted(id, true)) },
      }),
    },
  ),
  toggleTodo: defineMutation(
    'toggleTodo',
    Schema.Struct({ id: Schema.String }),
    'UPDATE todos SET completed = NOT completed WHERE id = $id',
    {
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
    },
  ),
  setReadonlyTodo: defineMutation(
    'setReadonlyTodo',
    Schema.Struct({ id: Schema.String, readonly: Schema.Boolean }),
    'UPDATE todos SET readonly = $readonly WHERE id = $id',
    {
      facts: ({ id, readonly }) => ({
        require: [facts.todoExists(id)],
        modify: { set: [facts.todoIsWriteable(id, !readonly)] },
      }),
    },
  ),
  setTextTodo: defineMutation(
    'setTextTodo',
    Schema.Struct({ id: Schema.String, text: Schema.String }),
    'UPDATE todos SET text = $text WHERE id = $id',
    {
      facts: ({ id }) => ({
        require: [facts.todoExists(id), facts.todoIsWriteable(id, true)],
        modify: { set: [facts.todoTextUpdated(id)] },
      }),
    },
  ),
  setInputValue: defineMutation(
    'setInputValue',
    Schema.Struct({ id: Schema.String, text: Schema.String }),
    'UPDATE todos SET text = $text WHERE id = $id',
    {
      localOnly: true,
      facts: ({ id }) => ({ modify: { set: [facts.inputValue(id)] } }),
    },
  ),
}

export type PartialEvent = { mutation: string; args: any }

export const toEventNodes = (
  partialEvents: PartialEvent[],
  mutationDefs: Record<string, MutationDef.Any>,
  clientId: string,
  sessionId: string | undefined,
): HistoryDagNode[] => {
  const nodesAcc: HistoryDagNode[] = [rootEventNode]

  let currentEventId: EventId.EventId = EventId.ROOT

  const eventNodes = partialEvents.map((partialEvent) => {
    const mutationDef = mutationDefs[partialEvent.mutation]!
    const eventId = EventId.nextPair(currentEventId, mutationDef.options.localOnly).id
    currentEventId = eventId

    const factsSnapshot = factsSnapshotForDag(historyDagFromNodes(nodesAcc, { skipFactsCheck: true }), undefined)
    // console.log('factsSnapshot', eventId, factsSnapshot)
    // const depRead: MutationEventFactsSnapshot = new Map<string, any>()
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

    // const factsRes = mutationDef.options.facts?.(partialEvent.args, factsSnapshotProxy)
    // console.log('factsRes', factsRes?.modify, factsRes?.require)
    // const iterableToMap = (iterable: Iterable<MutationEventFactInput>) => {
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
    // } satisfies MutationEventFactsGroup

    // applyFactGroup(facts, factsSnapshot)

    const facts = getFactsGroupForMutationArgs({
      factsCallback: mutationDef.options.facts,
      args: partialEvent.args,
      currentFacts: factsSnapshot,
    })

    const node = {
      id: eventId,
      parentId: getParentId(eventId),
      mutation: partialEvent.mutation,
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
  const localParentId = eventId.local - 1

  if (localParentId < 0) {
    return EventId.make({ global: globalParentId - 1, local: EventId.localDefault })
  }

  return EventId.make({ global: globalParentId, local: localParentId })
}
