import { useStore } from '@livestore/react'
import { useSearch } from '@tanstack/react-router'

import { allFoodsQuery$ } from '../lib/queries.js'
import { events } from '../lib/schema.js'

export const InsertMealForm = () => {
  const { date } = useSearch({ from: '/' })
  const { store } = useStore()

  const foods = store.useQuery(allFoodsQuery$)
  const action = (formData: globalThis.FormData) => {
    const foodId = formData.get('foodId')
    const quantity = formData.get('quantity')
    store.commit(
      events.mealCreated({
        date,
        id: crypto.randomUUID(),
        foodId: foodId as string,
        quantity: Number(quantity),
      }),
    )
  }

  return (
    <form action={action}>
      <input type="number" name="quantity" placeholder="Quantity" />
      <div>
        {foods.map((food) => (
          <label key={food.id}>
            <input type="radio" name="foodId" value={food.id} />
            <span>{food.name}</span>
          </label>
        ))}
      </div>

      <button type="submit">Insert meal</button>
    </form>
  )
}
