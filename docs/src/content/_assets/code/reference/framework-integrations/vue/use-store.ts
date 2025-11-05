import { useStore } from 'vue-livestore'

import { events } from './schema.ts'

export const createTodo = () => {
  const { store } = useStore()

  store.commit(events.todoCreated({ id: crypto.randomUUID(), text: 'Eat broccoli' }))
}
