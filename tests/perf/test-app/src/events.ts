import { Events, Schema } from '@livestore/livestore'

export const thousandItemsCreated = Events.synced({
  name: 'v1.ThousandItemsCreated',
  schema: Schema.Array(Schema.Struct({ id: Schema.Number, label: Schema.String })).pipe(Schema.itemsCount(1000)),
})

export const tenThousandItemsCreated = Events.synced({
  name: 'v1.TenThousandItemsCreated',
  schema: Schema.Array(Schema.Struct({ id: Schema.Number, label: Schema.String })).pipe(Schema.itemsCount(10_000)),
})

export const thousandItemsAppended = Events.synced({
  name: 'v1.ThousandItemsAppended',
  schema: Schema.Array(Schema.Struct({ id: Schema.Number, label: Schema.String })).pipe(Schema.itemsCount(1000)),
})

export const everyTenthItemUpdated = Events.synced({
  name: 'v1.EveryTenthItemUpdated',
  schema: Schema.Void,
})

export const itemDeleted = Events.synced({
  name: 'v1.ItemDeleted',
  schema: Schema.Struct({ id: Schema.Number }),
})

export const allItemsDeleted = Events.synced({
  name: 'v1.AllItemsDeleted',
  schema: Schema.Void,
})
