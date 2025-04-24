import { computed, queryDb, Schema, sql } from '@livestore/livestore'
import { Number } from 'effect'

import { tables } from './schema.js'
import { convertMacroQuantity } from './utils.js'

// Query using livestore's API (`select`)
export const allFoodsQuery$ = queryDb(tables.foods.select())

const allMealsWithFoodsQuery$ = queryDb({
  // Raw SQL query using `sql`
  query: sql`
  SELECT meal.id, meal.date, meal.quantity, food.name, food.calories, food.protein, food.carbs, food.fat
  FROM meal
  INNER JOIN food ON meal.foodId = food.id
  `,

  // Schema derived from `schema` of tables (`rowSchema`)
  schema: Schema.Array(
    tables.meals.rowSchema.pipe(
      Schema.omit('foodId'),
      Schema.extend(tables.foods.rowSchema.pipe(Schema.pick('name', 'calories'))),
    ),
  ),
})

// Computed value to format the meals data
export const convertedMealsQuery$ = computed((get) => {
  const meals = get(allMealsWithFoodsQuery$)
  return meals.map((meal) => ({
    id: meal.id,
    name: meal.name,
    quantity: meal.quantity,
    calories: convertMacroQuantity({
      quantity: meal.quantity,
      macro: meal.calories,
    }),
  }))
})

// Computed value to calculate the total macros (calories)
export const totalMacrosQuery$ = computed((get) => {
  const meals = get(convertedMealsQuery$)
  return { calories: Number.sumAll(meals.map((meal) => meal.calories)) }
})
