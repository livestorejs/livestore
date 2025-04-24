import { State } from '@livestore/livestore'

import * as events from './events.js'
import { foods, meals } from './tables.js'

// You will get a type error if you don't provide an implementation for each event
export const materializers = State.SQLite.materializers(events, {
  /**
   * Map the `v1.MealCreated` event to an `insert` operation on the `meals` table
   *
   * The parameters are derived from the event payload
   */
  'v1.MealCreated': ({ id, foodId, quantity }) => meals.insert({ id, foodId, quantity }),

  'v1.FoodCreated': ({ name, calories }) =>
    foods.insert({
      id: crypto.randomUUID(),
      name,
      calories,
    }),

  'v1.FoodUpdated': ({ id, name, calories }) => foods.update({ name, calories }).where({ id }),

  'v1.MealUpdated': ({ id, quantity }) => meals.update({ quantity }).where({ id }),
})
