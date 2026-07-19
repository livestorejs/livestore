import { Events, Schema } from '@livestore/livestore'

export const thousandItemsCreated = Events.synced({
  name: 'v1.ThousandItemsCreated',
  schema: Schema.Array(Schema.Struct({ id: Schema.Finite, label: Schema.String })).check(
    Schema.isLengthBetween(1000, 1000),
  ),
})

export const tenThousandItemsCreated = Events.synced({
  name: 'v1.TenThousandItemsCreated',
  schema: Schema.Array(Schema.Struct({ id: Schema.Finite, label: Schema.String })).check(
    Schema.isLengthBetween(10_000, 10_000),
  ),
})

export const thousandItemsAppended = Events.synced({
  name: 'v1.ThousandItemsAppended',
  schema: Schema.Array(Schema.Struct({ id: Schema.Finite, label: Schema.String })).check(
    Schema.isLengthBetween(1000, 1000),
  ),
})

export const everyTenthItemUpdated = Events.synced({
  name: 'v1.EveryTenthItemUpdated',
  schema: Schema.Void,
})

export const itemDeleted = Events.synced({
  name: 'v1.ItemDeleted',
  schema: Schema.Struct({ id: Schema.Finite }),
})

export const allItemsDeleted = Events.synced({
  name: 'v1.AllItemsDeleted',
  schema: Schema.Void,
})
