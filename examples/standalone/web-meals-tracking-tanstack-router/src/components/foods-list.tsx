import { useStore } from '@livestore/react'

import { foodUpdated } from '../lib/events.js'
import { allFoodsQuery$ } from '../lib/queries.js'

export const FoodsList = () => {
  const { store } = useStore()

  const foods = store.useQuery(allFoodsQuery$)

  return (
    <div>
      {foods.map((food) => (
        <div key={food.id}>
          <input
            type="text"
            value={food.name}
            onChange={(e) => {
              store.commit(foodUpdated({ id: food.id, name: e.target.value }))
            }}
          />
          <input
            type="number"
            value={food.calories}
            onChange={(e) => {
              store.commit(foodUpdated({ id: food.id, calories: e.target.valueAsNumber }))
            }}
          />
        </div>
      ))}
    </div>
  )
}
