import { State } from "@livestore/livestore";
import * as events from "./events";
import { foods, meals } from "./tables";

// ?: Why the name `materializers`? What about `actions`?
export const materializers = State.SQLite.materializers(events, {
  "v1.MealCreated": ({ id, foodId, quantity, date }) =>
    meals.insert({ id, foodId, quantity, date }),

  "v1.FoodCreated": ({ name, calories, protein, carbs, fat }) =>
    foods.insert({
      id: crypto.randomUUID(),
      name,
      calories,
      protein,
      carbs,
      fat,
    }),

  "v1.FoodUpdated": ({ id, name, calories, protein, carbs, fat }) =>
    foods.update({ name, calories, protein, carbs, fat }).where({ id }),

  "v1.MealUpdated": ({ id, quantity }) =>
    meals.update({ quantity }).where({ id }),
});
