import { useStore } from '@livestore/react'

import { events } from '../lib/schema.js'

export const InsertFoodForm = () => {
  const { store } = useStore()
  const action = (formData: globalThis.FormData) => {
    const name = formData.get('name')
    const calories = formData.get('calories')
    store.commit(
      events.foodCreated({
        name: name as string,
        calories: Number(calories),
      }),
    )
  }
  return (
    <form action={action}>
      <div>
        <input type="text" name="name" placeholder="Name" />
        <input type="number" name="calories" placeholder="Calories" />
      </div>

      <button type="submit">Insert food</button>
    </form>
  )
}
