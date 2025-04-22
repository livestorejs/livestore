import { makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

import * as eventsDefs from './events.js'

const items = State.SQLite.table({
  name: 'items',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    label: State.SQLite.text({ nullable: false }),
  },
})

export type Item = typeof items.Type
export type Items = Item[]

const uiState = State.SQLite.clientDocument({
  name: 'uiState',
  schema: Schema.Struct({ selected: Schema.NullOr(Schema.Number) }),
  default: {
    id: SessionIdSymbol,
    value: { selected: null },
  },
})

export type UiState = typeof uiState.Value

export const events = {
  ...eventsDefs,
  uiStateSet: uiState.set,
}

export const tables = { items, uiState }

const materializers = State.SQLite.materializers(events, {
  'v1.ThousandItemsCreated': (thousandItems) => [items.delete(), ...thousandItems.map((item) => items.insert(item))],
  'v1.TenThousandItemsCreated': (tenThousandItems) => [
    items.delete(),
    ...tenThousandItems.map((item) => items.insert(item)),
  ],
  'v1.ThousandItemsAppended': (thousandItems) => thousandItems.map((item) => items.insert(item)),
  'v1.ItemDeleted': ({ id }) => items.delete().where({ id }),
  // 'v1.EveryTenthItemUpdated': () => {
  //   const allItems = items.select()
  //
  //   const updates = []
  //   for (let i = 0; i < allItems.length; i += 10) {
  //     updates.push(items.update({ label: allItems[i].label + ' !!!' }).where({ id: allItems[i].id }))
  //   }
  //
  //   return updates
  // },
  'v1.AllItemsDeleted': () => items.delete(),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
