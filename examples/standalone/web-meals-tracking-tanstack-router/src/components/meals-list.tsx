import { useStore } from '@livestore/react'

import { convertedMealsQuery$, totalMacrosQuery$ } from '../lib/queries.js'
import { events } from '../lib/schema.js'

export const MealsList = () => {
  const { store } = useStore()

  const totalMacros = store.useQuery(totalMacrosQuery$)
  const meals = store.useQuery(convertedMealsQuery$)

  return (
    <div>
      <p>Total calories: {totalMacros.calories.toFixed(2)}</p>

      {meals.map((meal) => (
        <div key={meal.id}>
          <p>{meal.name}</p>
          <p>Calories: {meal.calories.toFixed(2)}</p>

          <input
            type="number"
            value={meal.quantity}
            onChange={(e) => {
              store.commit(
                events.mealUpdated({
                  id: meal.id,
                  quantity: e.target.valueAsNumber,
                }),
              )
            }}
          />
        </div>
      ))}
    </div>
  )
}
