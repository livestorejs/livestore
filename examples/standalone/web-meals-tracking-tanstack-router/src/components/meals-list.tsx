import { useStore } from '@livestore/react'

import { convertedMealsQuery$, filterFoodsQuery$, totalMacrosQuery$ } from '../lib/queries.js'
import { events } from '../lib/schema.js'

export const MealsList = () => {
  const { store } = useStore()
  const filterFoods = store.useQuery(filterFoodsQuery$)
  const totalMacros = store.useQuery(totalMacrosQuery$)
  const meals = store.useQuery(convertedMealsQuery$)
  return (
    <div>
      <h2>Meals</h2>

      <div>
        <p>Calories</p>
        <p>{totalMacros.calories.toFixed(2)}</p>
      </div>

      <input
        type="text"
        placeholder="Filter by food name"
        value={filterFoods.name}
        onChange={(e) => {
          store.commit(events.setFilterFoods({ name: e.target.value }))
        }}
      />

      <hr />

      <div>
        {meals.map((meal) => (
          <div key={meal.id}>
            <div>
              <p>{meal.name}</p>
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
            <div>
              <p>Calories</p>
              <p>{meal.calories.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
