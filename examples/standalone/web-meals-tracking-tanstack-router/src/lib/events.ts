import { Events, Schema } from '@livestore/livestore'

export const foodCreated = Events.synced({
  // Unique name for the event
  name: 'v1.FoodCreated',

  // Parameters accepted by the event (validated using a `Schema`)
  schema: Schema.Struct({
    name: Schema.String,
    calories: Schema.Number,
  }),
})

export const mealCreated = Events.synced({
  name: 'v1.MealCreated',
  schema: Schema.Struct({
    id: Schema.UUID,
    foodId: Schema.String,
    quantity: Schema.Number,
  }),
})

export const foodUpdated = Events.synced({
  name: 'v1.FoodUpdated',
  schema: Schema.Struct({
    id: Schema.String,
    name: Schema.optional(Schema.String),
    calories: Schema.optional(Schema.Number),
  }),
})

export const mealUpdated = Events.synced({
  name: 'v1.MealUpdated',
  schema: Schema.Struct({
    id: Schema.String,
    quantity: Schema.optional(Schema.Number),
  }),
})
