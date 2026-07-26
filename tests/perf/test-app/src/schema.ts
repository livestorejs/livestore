import { Events, makeSchema, Schema, State } from '@livestore/livestore'

import * as eventsDefs from './events.ts'

const items = State.SQLite.table({
  name: 'items',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    label: State.SQLite.text({ nullable: false }),
  },
})

export type Item = typeof items.Type
export type Items = Item[]

const uiState = State.SQLite.table({
  name: 'uiState',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    selected: State.SQLite.real({ nullable: true, schema: Schema.Finite }),
  },
})

export type UiState = typeof uiState.Type

export const events = {
  ...eventsDefs,
  uiStateSet: Events.clientOnly({
    name: 'v1.UiStateSet',
    schema: Schema.Struct({ id: Schema.String, selected: Schema.NullOr(Schema.Finite) }),
  }),
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
  'v1.EveryTenthItemUpdated': (_, ctx) => {
    const allItems = ctx.query(items.select())

    const updates = []
    for (let i = 0; i < allItems.length; i += 10) {
      updates.push(items.update({ label: `${allItems[i]!.label} !!!` }).where({ id: allItems[i]!.id }))
    }

    return updates
  },
  'v1.AllItemsDeleted': () => items.delete(),
  'v1.UiStateSet': ({ id, selected }) => uiState.insert({ id, selected }).onConflict('id', 'update', { selected }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

export type AppSchema = typeof schema
