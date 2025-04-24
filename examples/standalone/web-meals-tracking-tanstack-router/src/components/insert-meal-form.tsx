import { useStore } from '@livestore/react'

import { allFoodsQuery$ } from '../lib/queries.js'
import { events } from '../lib/schema.js'

export const InsertMealForm = () => {
  const { store } = useStore()

  const foods = store.useQuery(allFoodsQuery$)
  const action = (formData: globalThis.FormData) => {
    const foodId = formData.get('foodId')
    const quantity = formData.get('quantity')
    store.commit(
      events.mealCreated({
        id: crypto.randomUUID(),
        foodId: foodId as string,
        quantity: Number(quantity),
      }),
    )
  }

  return (
    <form action={action}>
      <input type="number" name="quantity" placeholder="Quantity" />

      {foods.map((food) => (
        <label key={food.id}>
          <input type="radio" name="foodId" value={food.id} />
          <span>{food.name}</span>
        </label>
      ))}

      <button type="submit">Insert meal</button>
    </form>
  )
}
