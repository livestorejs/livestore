import { Schema, State } from '@livestore/livestore'

// Schema from `effect` re-exported from the `livestore` package
const NonNegativeNumber = Schema.Number.pipe(Schema.nonNegative())

export const foods = State.SQLite.table({
  // Name of the table in the database
  name: 'food',

  // Indexes to speed up queries (e.g. search food by name)
  indexes: [{ columns: ['name'], name: 'name', isUnique: true }],

  // Columns of the table
  columns: {
    id: State.SQLite.text({ primaryKey: true, schema: Schema.UUID }),
    calories: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
    name: State.SQLite.text({
      // Additional constraints on the data using the `schema` option
      schema: Schema.NonEmptyString,
    }),
  },
})

export const meals = State.SQLite.table({
  name: 'meal',
  columns: {
    id: State.SQLite.text({ primaryKey: true, schema: Schema.UUID }),
    foodId: State.SQLite.text({ schema: Schema.UUID }),
    quantity: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
  },
})
