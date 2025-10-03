import { queryDb, State, type Store } from '@livestore/livestore'

declare const store: Store

const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
      completed: State.SQLite.boolean({ default: false }),
    },
  }),
} as const

const count$ = queryDb(tables.todos.count(), { label: 'count$' })
const count = store.query(count$)
console.log(count)

const unsubscribe = store.subscribe(count$, {
  onUpdate: (value) => {
    console.log(value)
  },
})

unsubscribe()
