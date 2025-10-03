import type { Store } from '@livestore/livestore'

import { storeTables } from './schema.ts'

declare const store: Store

const unsubscribe = store.subscribe(storeTables.todos, {
  onUpdate: (todos) => {
    console.log(todos)
  },
})

unsubscribe()
