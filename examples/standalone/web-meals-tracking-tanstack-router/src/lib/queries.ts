import { computed, queryDb, Schema, signal, sql } from '@livestore/livestore'
import { Number } from 'effect'

import { tables } from './schema.js'
import { convertMacroQuantity } from './utils.js'

export const allFoodsQuery$ = queryDb(tables.foods.select())

export const filterFoodsQuery$ = queryDb(tables.filterFoodsDocument.get())

export const dateSearchParamSignal$ = signal(
  (() => {
    const searchParams = new URLSearchParams(globalThis.location.search)
    const date = searchParams.get('date')
    return date!
  })(),
)

const allMealsWithFoodsQuery$ = queryDb((get) => {
  const date = get(dateSearchParamSignal$)
  const { name } = get(filterFoodsQuery$)
  return {
    query: sql`
    SELECT meal.id, meal.date, meal.quantity, food.name, food.calories, food.protein, food.carbs, food.fat
    FROM meal
    INNER JOIN food ON meal.foodId = food.id
    WHERE meal.date = '${date}'
    ${name ? `AND food.name LIKE '%${name}%'` : ``}
  `,
    schema: Schema.Array(
      tables.meals.rowSchema.pipe(
        Schema.omit('foodId'),
        Schema.extend(tables.foods.rowSchema.pipe(Schema.pick('name', 'calories'))),
      ),
    ),
  }
})

export const convertedMealsQuery$ = computed((get) => {
  const meals = get(allMealsWithFoodsQuery$)
  return meals.map((meal) => ({
    id: meal.id,
    name: meal.name,
    quantity: meal.quantity,
    date: meal.date,
    calories: convertMacroQuantity({
      quantity: meal.quantity,
      macro: meal.calories,
    }),
  }))
})

export const totalMacrosQuery$ = computed((get) => {
  const meals = get(convertedMealsQuery$)
  return { calories: Number.sumAll(meals.map((meal) => meal.calories)) }
})
