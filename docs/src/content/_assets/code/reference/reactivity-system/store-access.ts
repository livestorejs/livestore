import { queryDb, type Store } from '@livestore/livestore'
import { type schema, tables } from '../framework-integrations/react/schema.ts'

declare const store: Store<typeof schema>

const count$ = queryDb(tables.todos.count(), { label: 'count$' })
const count = store.query(count$)
console.log(count)

const unsubscribe = store.subscribe(count$, (value) => {
  console.log(value)
})

unsubscribe()
