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
    selected: State.SQLite.integer({ nullable: true }),
  },
})

export type UiState = Pick<typeof uiState.Type, 'selected'>

export const events = {
  ...eventsDefs,
  uiStateSet: Events.clientOnly({
    name: 'v1.UiStateSet',
    schema: Schema.Struct({ selected: Schema.NullOr(Schema.Number) }),
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
  'v1.UiStateSet': ({ selected }) =>
    uiState.insert({ id: 'default', selected }).onConflict('id', 'update', { selected }),
  'v1.EveryTenthItemUpdated': (_, ctx) => {
    const allItems = ctx.query(items.select())

    const updates = []
    for (let i = 0; i < allItems.length; i += 10) {
      updates.push(items.update({ label: `${allItems[i]!.label} !!!` }).where({ id: allItems[i]!.id }))
    }

    return updates
  },
  'v1.AllItemsDeleted': () => items.delete(),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

export type AppSchema = typeof schema
