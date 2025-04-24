import { Schema, State } from '@livestore/livestore'

const NonNegativeNumber = Schema.Number.pipe(Schema.nonNegative())

export const foods = State.SQLite.table({
  name: 'food',
  indexes: [{ columns: ['name'], name: 'name', isUnique: true }],
  columns: {
    id: State.SQLite.text({ primaryKey: true, schema: Schema.UUID }),
    name: State.SQLite.text({ schema: Schema.NonEmptyString }),
    calories: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
  },
})

export const meals = State.SQLite.table({
  name: 'meal',
  columns: {
    id: State.SQLite.text({ primaryKey: true, schema: Schema.UUID }),
    foodId: State.SQLite.text({ schema: Schema.UUID }),
    quantity: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
    date: State.SQLite.text(),
  },
})
